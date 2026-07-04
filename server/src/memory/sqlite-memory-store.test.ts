import { describe, it, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { SqliteMemoryStore } from './sqlite-memory-store.js'
import { FakeEmbedding } from '../llm/embedding.js'
import { FakeLLM } from '../llm/fake.js'

// 纯 SQLite,无需 Surreal 进程。FakeEmbedding 同文本同向量 → 精确匹配 cosine=1。
function mk(opts: Partial<{ llm: FakeLLM; simThreshold: number; retrieveMinSim: number }> = {}) {
  const db = openDb(':memory:')
  let clock = Date.parse('2026-07-01T00:00:00.000Z')
  const store = new SqliteMemoryStore({
    db, embedding: new FakeEmbedding(16), llm: opts.llm ?? new FakeLLM(['keep']),
    now: () => clock, simThreshold: opts.simThreshold ?? -1, retrieveMinSim: opts.retrieveMinSim ?? -1,
  })
  return { db, store, tick: (ms: number) => { clock += ms }, iso: () => new Date(clock).toISOString() }
}

describe('SqliteMemoryStore', () => {
  it('record fact 后 retrieve 能召回,episode 不混入检索', async () => {
    const { store, iso } = mk()
    await store.record({ personaId: 'coach', kind: 'episode', content: '这步软了', importance: 1, gameId: 1, createdAt: iso() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: iso() })
    const got = await store.retrieve('coach', '残局急躁', 5, ['fact', 'insight'])
    expect(got).toHaveLength(1)
    expect(got[0].content).toBe('残局易急躁')
  })

  it('judge=supersede:旧条作废,retrieve 不再返回,list(includeSuperseded) 仍可见', async () => {
    const { store, iso } = mk({ llm: new FakeLLM(['supersede']), simThreshold: 0.5 })
    const id = await store.record({ personaId: 'laopaoer', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: 1, createdAt: iso() })
    // 与旧条完全一致的新内容 → cosine=1 ≥0.5 → 触发 judge=supersede
    await store.record({ personaId: 'laopaoer', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: 2, createdAt: iso() })
    expect(await store.retrieve('laopaoer', '当头炮', 5, ['fact'])).toHaveLength(1) // 只剩新条
    expect(await store.list({ personaId: 'laopaoer' })).toHaveLength(1)             // 默认排除作废
    expect(await store.list({ personaId: 'laopaoer', includeSuperseded: true })).toHaveLength(2)
    expect(id).toBeTruthy()
  })

  it('judge=merge:合并进旧条(不新增),importance +1', async () => {
    const { store, iso } = mk({ llm: new FakeLLM(['merge: 爱走当头炮且擅长中炮强攻']), simThreshold: 0.5 })
    await store.record({ personaId: 'coach', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: 1, createdAt: iso() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: 2, createdAt: iso() })
    const rows = await store.list({ personaId: 'coach' })
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('爱走当头炮且擅长中炮强攻')
    expect(rows[0].importance).toBe(4)
  })

  it('检索相关度地板:sim 低于 retrieveMinSim 的记忆不注入(L1)', async () => {
    const { store, iso } = mk({ retrieveMinSim: 1.1 }) // 地板 1.1 > cosine 上限 1.0
    await store.record({ personaId: 'coach', kind: 'fact', content: '当头炮开局', importance: 3, gameId: null, createdAt: iso() })
    // 即便与内容完全一致(cosine=1.0),1.0<1.1 → 被地板过滤
    expect(await store.retrieve('coach', '当头炮开局', 5, ['fact'])).toHaveLength(0)
  })

  it('嵌入失败降级:照存无向量,retrieve 退回 recency 不崩,isDegraded/reason 指出嵌入异常(L2)', async () => {
    const db = openDb(':memory:')
    const failing = { embed: async () => { throw new Error('boom') }, dimension: 16 }
    const store = new SqliteMemoryStore({ db, embedding: failing as any, llm: new FakeLLM(['keep']), now: () => 0, retrieveMinSim: -1 })
    const id = await store.record({ personaId: 'player', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    expect(id).toBeTruthy()
    expect(await store.retrieve('player', '当头炮', 5, ['fact'])).toHaveLength(1) // recency 兜底
    expect(store.isDegraded()).toBe(true)
    expect(store.degradedReason()).toContain('嵌入')
  })

  it('update 改 content(重嵌入);remove 删除;removeByGame 级联', async () => {
    const { store, iso } = mk()
    const id = await store.record({ personaId: 'coach', kind: 'fact', content: 'A', importance: 3, gameId: 7, createdAt: iso() })
    await store.update(id, { content: 'B', importance: 5 })
    const one = (await store.list({ personaId: 'coach' }))[0]
    expect(one.content).toBe('B'); expect(one.importance).toBe(5)
    await store.record({ personaId: 'coach', kind: 'fact', content: 'C', importance: 2, gameId: 7, createdAt: iso() })
    await store.removeByGame(7)
    expect(await store.list({ personaId: 'coach' })).toHaveLength(0)
  })

  it('健康态:未发生嵌入失败时 isDegraded=false, degradedReason=null', () => {
    const { store } = mk()
    expect(store.isDegraded()).toBe(false)
    expect(store.degradedReason()).toBeNull()
  })
})
