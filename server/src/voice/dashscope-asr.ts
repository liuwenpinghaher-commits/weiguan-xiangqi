import OpenAI from 'openai'
import type { AsrProvider } from './asr.js'

/** 阿里云百炼 qwen3-asr-flash(OpenAI 兼容 chat/completions + input_audio)。
 *  client 可注入以便测试不打网络;复用与 LLM 相同的 compatible-mode/v1 baseURL。 */
export class DashscopeAsr implements AsrProvider {
  private client: { chat: { completions: { create: (b: any) => Promise<any> } } }

  constructor(
    private model = process.env.ASR_MODEL ?? 'qwen3-asr-flash',
    apiKey?: string,
    baseURL?: string,
    client?: { chat: { completions: { create: (b: any) => Promise<any> } } },
  ) {
    if (client) {
      this.client = client
    } else {
      if (!apiKey || !baseURL) throw new Error('缺少 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL(见 .env)')
      this.client = new OpenAI({ apiKey, baseURL }) as any
    }
  }

  async transcribe(audio: Buffer, mimeType: string): Promise<string> {
    const dataUri = `data:${mimeType};base64,${audio.toString('base64')}`
    const body: any = {
      model: this.model,
      messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] }],
    }
    const resp: any = await this.client.chat.completions.create(body)
    const content = resp.choices?.[0]?.message?.content
    return typeof content === 'string' ? content.trim() : ''
  }
}
