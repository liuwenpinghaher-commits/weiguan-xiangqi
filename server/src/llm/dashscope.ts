import OpenAI from 'openai'
import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'

/**
 * LLM 调用轻量重试:仅对网络错误 / 5xx / 429 重试,4xx(非 429)立即抛。
 * 成功即返回,不做多余调用;重试耗尽后抛最后一次错误(同类错误)。
 * delaysMs 默认 [300, 800](指数退避),即最多重试 2 次、共 3 次尝试。
 */
export async function withLLMRetry<T>(
  fn: () => Promise<T>,
  delaysMs: number[] = [300, 800],
  sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms)),
): Promise<T> {
  let attempt = 0
  for (;;) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= delaysMs.length || !isRetryable(err)) throw err
      await sleep(delaysMs[attempt])
      attempt++
    }
  }
}

/** 可重试:网络/超时错误,或 HTTP 状态为 429 / 5xx。非 429 的 4xx 不重试。 */
export function isRetryable(err: unknown): boolean {
  const status = (err as { status?: number } | null)?.status
  if (typeof status === 'number') return status === 429 || status >= 500
  // 无 status 的多为网络/超时/连接错误(APIConnectionError 等)→ 可重试
  return true
}

/**
 * 阿里百炼(DashScope) OpenAI 兼容层 LLM。
 * qwen 兼容端(flash/plus 等)默认不思考、直接出短答,无需 thinking:{type:'disabled'} 扩展字段。
 */
export class DashscopeLLM implements LLMProvider {
  private client: OpenAI
  constructor(
    private model = process.env.DASHSCOPE_MODEL ?? 'qwen-plus',
    apiKey = process.env.DASHSCOPE_API_KEY,
    baseURL = process.env.DASHSCOPE_BASE_URL,
  ) {
    if (!apiKey || !baseURL) throw new Error('缺少 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL(见 .env)')
    // 30s 超时:防 DashScope 卡住时无限挂起拖垮 worker
    this.client = new OpenAI({ apiKey, baseURL, timeout: 30_000 })
  }

  async chat(messages: ChatMsg[], opts: LLMOpts = {}): Promise<string> {
    // 用 any 容纳非标准键(temperature 等直传)
    const body: any = {
      model: this.model,
      messages,
      max_tokens: opts.maxTokens ?? 200,
    }
    if (opts.temperature != null) body.temperature = opts.temperature
    // qwen 兼容端(flash/plus 等)默认不思考,不传 thinking 字段
    const resp: any = await withLLMRetry(() => this.client.chat.completions.create(body))
    return resp.choices?.[0]?.message?.content ?? ''
  }
}
