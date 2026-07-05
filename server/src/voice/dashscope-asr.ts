import OpenAI from 'openai'
import type { AsrProvider } from './asr.js'

/** ASR 凭据:只读 DASHSCOPE env,与 chat 模型(可换 DeepSeek 等)彻底解耦。
 *  ASR/TTS 都是百炼专有模型,凭据必须独立;两者缺一返回 null(端点据此 503)。 */
export function dashscopeAsrCreds(): { apiKey: string; baseURL: string } | null {
  const apiKey = process.env.DASHSCOPE_API_KEY
  const baseURL = process.env.DASHSCOPE_BASE_URL
  return apiKey && baseURL ? { apiKey, baseURL } : null
}

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
      // 30s 超时:防 ASR 请求卡住挂起 worker
      this.client = new OpenAI({ apiKey, baseURL, timeout: 30_000 }) as any
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
