import { describe, it, expect } from 'vitest'
import { FakeMemoryStore } from './fake-memory-store.js'

const t0 = Date.parse('2026-06-20T00:00:00.000Z')

function freshStore() {
  let clock = t0
  const store = new FakeMemoryStore(() => clock)
  return { store, tick: (ms: number) => { clock += ms }, iso: () => new Date(clock).toISOString() }
}

describe('FakeMemoryStore', () => {
  it('record 返回 id,list 能查回', async () => {
    const { store, iso } = freshStore()
    const id = await store.record({ personaId: 'laopaoer', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: 1, createdAt: iso() })
    expect(id).toBeTruthy()
    const rows = await store.list({ personaId: 'laopaoer' })
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('爱走当头炮')
  })

  it('retrieve 按 kinds 过滤,episode 不混入 fact/insight 检索', async () => {
    const { store, iso } = freshStore()
    await store.record({ personaId: 'coach', kind: 'episode', content: '这步软了', importance: 1, gameId: 1, createdAt: iso() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: iso() })
    const got = await store.retrieve('coach', '残局', 5, ['fact', 'insight'])
    expect(got.map(r => r.kind)).toEqual(['fact'])
  })

  it('retrieve 按 recency+importance 排序(新的/重要的靠前)', async () => {
    const { store, tick, iso } = freshStore()
    await store.record({ personaId: 'coach', kind: 'fact', content: '旧事实', importance: 3, gameId: 1, createdAt: iso() })
    tick(1000 * 60 * 60 * 24) // 一天后
    await store.record({ personaId: 'coach', kind: 'fact', content: '新事实', importance: 3, gameId: 2, createdAt: iso() })
    const got = await store.retrieve('coach', '事实', 2, ['fact'])
    expect(got[0].content).toBe('新事实')
  })

  it('update 改 content;remove 删除', async () => {
    const { store, iso } = freshStore()
    const id = await store.record({ personaId: 'coach', kind: 'fact', content: 'A', importance: 3, gameId: null, createdAt: iso() })
    await store.update(id, { content: 'B' })
    expect((await store.list({ personaId: 'coach' }))[0].content).toBe('B')
    await store.remove(id)
    expect(await store.list({ personaId: 'coach' })).toHaveLength(0)
  })

  it('list includeSuperseded 控制可见性', async () => {
    const { store, iso } = freshStore()
    const id = await store.record({ personaId: 'coach', kind: 'fact', content: '旧认知', importance: 3, gameId: null, createdAt: iso() })
    await store.markSuperseded(id, iso())
    expect(await store.list({ personaId: 'coach' })).toHaveLength(0)
    expect(await store.list({ personaId: 'coach', includeSuperseded: true })).toHaveLength(1)
    // 已作废不参与 retrieve
    expect(await store.retrieve('coach', '认知', 5, ['fact'])).toHaveLength(0)
  })

  it('降级信号:内存测试双 isDegraded=true 且 degradedReason 非空(L2)', () => {
    const { store } = freshStore()
    expect(store.isDegraded()).toBe(true)
    expect(store.degradedReason()).toContain('内存')
  })
})
