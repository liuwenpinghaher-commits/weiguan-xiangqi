import { describe, it, expect } from 'vitest'
import { DashscopeEmbedding } from './dashscope-embedding.js'

describe('DashscopeEmbedding', () => {
  it('调用注入的 client 并把响应映射为向量数组', async () => {
    const fakeClient = {
      embeddings: {
        create: async (body: any) => ({
          data: body.input.map((_: string, i: number) => ({ embedding: [i, i + 1, i + 2] })),
        }),
      },
    }
    const emb = new DashscopeEmbedding('text-embedding-v3', 3, fakeClient as any)
    const vecs = await emb.embed(['a', 'b'])
    expect(vecs).toEqual([[0, 1, 2], [1, 2, 3]])
    expect(emb.dimension).toBe(3)
  })
})
