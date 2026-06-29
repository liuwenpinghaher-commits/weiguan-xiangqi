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

  it('响应结构异常(data 缺失)时不抛 TypeError,返回空数组(让上层走无向量降级)', async () => {
    const fakeClient = { embeddings: { create: async () => ({}) } }
    const emb = new DashscopeEmbedding('text-embedding-v3', 3, fakeClient as any)
    await expect(emb.embed(['a'])).resolves.toEqual([])
  })

  it('乱序 data(带 index)按 index 重排,向量与输入对齐', async () => {
    // 端返回顺序打乱:index 2 在前、0 在中、1 在后;每个 embedding 用 index 当标记
    const fakeClient = {
      embeddings: {
        create: async () => ({
          data: [
            { index: 2, embedding: [2] },
            { index: 0, embedding: [0] },
            { index: 1, embedding: [1] },
          ],
        }),
      },
    }
    const emb = new DashscopeEmbedding('text-embedding-v3', 1, fakeClient as any)
    const vecs = await emb.embed(['a', 'b', 'c'])
    // 重排后应按 0,1,2 顺序,与输入 a,b,c 对齐
    expect(vecs).toEqual([[0], [1], [2]])
  })

  it('返回条数与输入不符 → 抛错(不静默错位)', async () => {
    const fakeClient = {
      embeddings: {
        create: async () => ({ data: [{ index: 0, embedding: [0] }] }), // 只回 1 条
      },
    }
    const emb = new DashscopeEmbedding('text-embedding-v3', 1, fakeClient as any)
    await expect(emb.embed(['a', 'b'])).rejects.toThrow(/条数不符/)
  })
})
