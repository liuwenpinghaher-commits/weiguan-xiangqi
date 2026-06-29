import OpenAI from 'openai'
import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'
import { withLLMRetry } from './dashscope.js'

export class VolcanoLLM implements LLMProvider {
  private client: OpenAI
  constructor(
    private model = process.env.ARK_MODEL ?? 'doubao-seed-2.0-pro',
    apiKey = process.env.ARK_API_KEY,
    baseURL = process.env.ARK_BASE_URL,
  ) {
    if (!apiKey || !baseURL) throw new Error('缺少 ARK_API_KEY / ARK_BASE_URL(见 .env)')
    // 30s 超时:与 dashscope 一致,防火山卡住时无限挂起拖垮 worker
    this.client = new OpenAI({ apiKey, baseURL, timeout: 30_000 })
  }

  async chat(messages: ChatMsg[], opts: LLMOpts = {}): Promise<string> {
    // thinking 是火山扩展字段,经 OpenAI SDK 透传(用 any 容纳非标准键)
    const body: any = {
      model: this.model,
      messages,
      max_tokens: opts.maxTokens ?? 200,
    }
    if (opts.temperature != null) body.temperature = opts.temperature
    if (opts.disableThinking) body.thinking = { type: 'disabled' }
    const resp: any = await withLLMRetry(() => this.client.chat.completions.create(body))
    return resp.choices?.[0]?.message?.content ?? ''
  }
}
