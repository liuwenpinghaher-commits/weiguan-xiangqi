export interface EmbeddingProvider {
  /** 返回与 texts 等长的向量数组,每个向量长度 = dimension */
  embed(texts: string[]): Promise<number[][]>
  readonly dimension: number
}

/** 测试用确定性嵌入:对文本做字符 hash 散布到 dimension 维,再 L2 归一化。
 *  无网络、可复现;同文本同向量、不同文本不同向量。 */
export class FakeEmbedding implements EmbeddingProvider {
  constructor(public readonly dimension = 16) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t))
  }

  private one(text: string): number[] {
    const v = new Array(this.dimension).fill(0)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      v[(code + i) % this.dimension] += ((code % 17) - 8) / 8 // 落在 [-1,1) 附近
    }
    // L2 归一化(避免全 0)
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  }
}
