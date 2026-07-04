import { withLLMRetry } from './dashscope.js'
import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'

/**
 * Ollama 本地 LLM:走 Ollama 原生 /api/chat,用 think 字段显式开关 Qwen3 系思考模式。
 *
 * 为何不复用 OpenAI 兼容 /v1:实测 Ollama 0.17.7 下 qwen3.5 的 /v1 端点关不掉思考——
 * chat_template_kwargs.enable_thinking、/no_think 软开关、顶层 think、Modelfile
 * `PARAMETER think` 全部无效(见 ollama#14502 / #14617)。思考型模型不关思考会把 token
 * 全烧在思考上、正文为空(finish=length),无法做实时弹幕。唯有私有 /api/chat 的
 * think 字段实测生效,故本地 chat 单独走这条,不经 OpenAI SDK。
 *
 * 分场景:高频弹幕 think=false(快、直接出正文);诊断/反思传 think=true 发挥 3.5 推理。
 * 嵌入不受影响——Ollama 的 /v1/embeddings 是标准 OpenAI 兼容,继续用 DashscopeEmbedding。
 */
export class OllamaLLM implements LLMProvider {
  private chatUrl: string
  constructor(private model: string, baseURL: string) {
    // 传入的是 OpenAI 兼容 baseURL(…/v1),转回 Ollama 原生根 + /api/chat
    const root = baseURL.replace(/\/v1\/?$/, '').replace(/\/+$/, '')
    this.chatUrl = `${root}/api/chat`
  }

  async chat(messages: ChatMsg[], opts: LLMOpts = {}): Promise<string> {
    const body = {
      model: this.model,
      messages,
      think: opts.think ?? false,   // 默认关思考(弹幕高频路径);诊断/反思显式开
      stream: false,
      options: {
        num_predict: opts.maxTokens ?? 200,
        ...(opts.temperature != null ? { temperature: opts.temperature } : {}),
      },
    }
    const resp = await withLLMRetry(async () => {
      const r = await fetch(this.chatUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),   // 每次尝试独立超时,防卡死拖垮 worker
      })
      if (!r.ok) {
        const e = new Error(`Ollama /api/chat HTTP ${r.status}`) as Error & { status?: number }
        e.status = r.status   // 让 withLLMRetry.isRetryable 按 4xx/5xx 判定
        throw e
      }
      return (await r.json()) as { message?: { content?: string } }
    })
    return resp.message?.content ?? ''
  }
}
