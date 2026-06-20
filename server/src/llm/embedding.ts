export interface EmbeddingProvider {
  /** 返回与 texts 等长的向量数组,每个向量长度 = dimension */
  embed(texts: string[]): Promise<number[][]>
  readonly dimension: number
}

/** 测试用确定性嵌入:对文本做字符 hash 散布到 dimension 维,再 L2 归一化。
 *  无网络、可复现;同文本同向量、不同文本不同向量。 */
export class FakeEmbedding implements EmbeddingProvider {
  // 默认 16:仅测试用小维度;生产维度由实际 EmbeddingProvider 决定
  constructor(public readonly dimension = 16) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t))
  }

  private one(text: string): number[] {
    const v = new Array(this.dimension).fill(0)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      // 每个字符写入两个不同槽位,避免单字符向量因只有一个非零分量
      // 而在 L2 归一化后相互碰撞(鸽巢原理:单槽无法区分 95 个 ASCII)
      v[(code + i * 7) % this.dimension]          += ((code * 31 + i) % 17 - 8) / 8
      v[(code * 13 + i * 3 + 7) % this.dimension] += ((code * 7 + i * 5) % 17 - 8) / 8
    }
    // L2 归一化(避免全 0)
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  }
}
