import OpenAI from 'openai'
import type { EmbeddingProvider } from './embedding.js'

/** DashScope text-embedding-v3(OpenAI 兼容 /embeddings)。
 *  维度可配置(v3 支持 1024/768/512 等,以实际响应为准);默认 1024。 */
export class DashscopeEmbedding implements EmbeddingProvider {
  private client: { embeddings: { create: (b: any) => Promise<any> } }

  constructor(
    private model = process.env.EMBEDDING_MODEL ?? 'text-embedding-v3',
    public readonly dimension = Number(process.env.EMBEDDING_DIM ?? 1024),
    client?: { embeddings: { create: (b: any) => Promise<any> } },
  ) {
    if (client) {
      this.client = client
    } else {
      const apiKey = process.env.DASHSCOPE_API_KEY
      const baseURL = process.env.DASHSCOPE_BASE_URL
      if (!apiKey || !baseURL) throw new Error('缺少 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL(见 .env)')
      // 30s 超时:防嵌入请求卡住拖垮记忆写入/检索
      this.client = new OpenAI({ apiKey, baseURL, timeout: 30_000 }) as any
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const resp: any = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimension,
    })
    // 结构异常(data 缺失)时返回空数组,由上层(embedOne 取 [0]→undefined→null)走无向量降级
    return (resp.data ?? []).map((d: any) => d.embedding as number[])
  }
}
