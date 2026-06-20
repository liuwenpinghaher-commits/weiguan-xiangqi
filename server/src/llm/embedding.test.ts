import { describe, it, expect } from 'vitest'
import { FakeEmbedding } from './embedding.js'

describe('FakeEmbedding', () => {
  it('返回与输入等长、且每个为定维向量', async () => {
    const emb = new FakeEmbedding(16)
    const vecs = await emb.embed(['当头炮', '把马跳'])
    expect(vecs).toHaveLength(2)
    expect(vecs[0]).toHaveLength(16)
    expect(emb.dimension).toBe(16)
  })

  it('确定性:同一文本两次嵌入完全相同', async () => {
    const emb = new FakeEmbedding(16)
    const [a] = await emb.embed(['残局易急躁'])
    const [b] = await emb.embed(['残局易急躁'])
    expect(a).toEqual(b)
  })

  it('不同文本向量不同', async () => {
    const emb = new FakeEmbedding(16)
    const [a] = await emb.embed(['爱走当头炮'])
    const [b] = await emb.embed(['偏好屏风马'])
    expect(a).not.toEqual(b)
  })
})
