import OpenAI from 'openai'
import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'

/**
 * 阿里百炼(DashScope) OpenAI 兼容层 LLM。
 * qwen-plus 默认不思考、直接出短答,无需 thinking:{type:'disabled'} 扩展字段。
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
    // 用 any 容纳非标准键(与 volcano.ts 同策略)
    const body: any = {
      model: this.model,
      messages,
      max_tokens: opts.maxTokens ?? 200,
    }
    if (opts.temperature != null) body.temperature = opts.temperature
    // qwen-plus 兼容端默认不思考,不传 thinking 字段
    const resp: any = await this.client.chat.completions.create(body)
    return resp.choices?.[0]?.message?.content ?? ''
  }
}
