import { describe, it, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { SqliteMemoryStore } from './sqlite-memory-store.js'
import { FakeEmbedding } from '../llm/embedding.js'
import type { EmbeddingProvider } from '../llm/embedding.js'
import { FakeLLM } from '../llm/fake.js'

/** 2D 单位向量嵌入:把每段文本映射到一个角度,cosine(a,b)=cos(角度差)。
 *  用来精确构造任意余弦相似度,验证默认地板/judge 阈的分界行为。 */
class AngleEmbedding implements EmbeddingProvider {
  readonly dimension = 2
  constructor(private angles: Record<string, number>) {}
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map(t => { const a = this.angles[t] ?? 0; return [Math.cos(a), Math.sin(a)] })
  }
}

/** 可切换故障的嵌入:fail=true 时抛错(模拟 Ollama 掉线),否则走确定性 FakeEmbedding。 */
class ToggleEmbedding implements EmbeddingProvider {
  readonly dimension = 16
  fail = false
  private inner = new FakeEmbedding(16)
  async embed(texts: string[]): Promise<number[][]> {
    if (this.fail) throw new Error('embedding down')
    return this.inner.embed(texts)
  }
}

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

  // ── P2-14 阈值重标定(bge-m3):默认地板 0.5、默认 judge 阈 0.7 ──
  it('默认检索地板(0.5):无关对(cos≈0.45)被滤、同域相关对(cos≈0.6)保留', async () => {
    const acos = (c: number) => Math.acos(c)
    const emb = new AngleEmbedding({ '查询话题': 0, '同域相关': acos(0.6), '无关闲话': acos(0.45) })
    const db = openDb(':memory:')
    // 不覆盖 retrieveMinSim/simThreshold → 使用生产默认值
    const store = new SqliteMemoryStore({ db, embedding: emb, llm: new FakeLLM(['keep']), now: () => 0 })
    await store.record({ personaId: 'coach', kind: 'fact', content: '同域相关', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '无关闲话', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    const got = await store.retrieve('coach', '查询话题', 5, ['fact'])
    expect(got.map(r => r.content)).toEqual(['同域相关'])
  })

  it('默认 judge 阈(0.7):相关不同事实(cos≈0.65)不触发 judge(照存两条)', async () => {
    const acos = (c: number) => Math.acos(c)
    const emb = new AngleEmbedding({ 'A原事实': 0, 'B相关不同事实': acos(0.65) })
    const db = openDb(':memory:')
    const store = new SqliteMemoryStore({ db, embedding: emb, llm: new FakeLLM(['supersede']), now: () => 0 })
    await store.record({ personaId: 'coach', kind: 'fact', content: 'A原事实', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: 'B相关不同事实', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    // 0.65 < 0.7 → 不 judge → 不 supersede → 两条并存
    expect(await store.list({ personaId: 'coach', includeSuperseded: true })).toHaveLength(2)
    expect(await store.list({ personaId: 'coach' })).toHaveLength(2)
  })

  it('默认 judge 阈(0.7):复述(cos≈0.75)触发 judge=supersede(旧条作废)', async () => {
    const acos = (c: number) => Math.acos(c)
    const emb = new AngleEmbedding({ 'A原事实': 0, 'B复述': acos(0.75) })
    const db = openDb(':memory:')
    const store = new SqliteMemoryStore({ db, embedding: emb, llm: new FakeLLM(['supersede']), now: () => 0 })
    await store.record({ personaId: 'coach', kind: 'fact', content: 'A原事实', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: 'B复述', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    // 0.75 ≥ 0.7 → judge → supersede → 旧条作废,默认 list 只剩 1
    expect(await store.list({ personaId: 'coach' })).toHaveLength(1)
    expect(await store.list({ personaId: 'coach', includeSuperseded: true })).toHaveLength(2)
  })

  // ── P2-19 bug:update 重嵌入失败不得清掉旧向量 ──
  it('update 重嵌入失败时保留旧向量(不写 NULL 覆盖)', async () => {
    const emb = new ToggleEmbedding()
    const db = openDb(':memory:')
    const store = new SqliteMemoryStore({ db, embedding: emb, llm: new FakeLLM(['keep']), now: () => 0, retrieveMinSim: -1 })
    const id = await store.record({ personaId: 'coach', kind: 'fact', content: 'A', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    const before = (db.prepare('SELECT embedding FROM memory WHERE id=?').get(Number(id)) as any).embedding
    expect(before).toBeTruthy()
    emb.fail = true // 编辑时嵌入服务掉线
    await store.update(id, { content: 'B' })
    const after = db.prepare('SELECT content, embedding FROM memory WHERE id=?').get(Number(id)) as any
    expect(after.content).toBe('B')            // 文本已更新
    expect(after.embedding).toBe(before)        // 旧向量保留,未被 NULL 覆盖
  })

  // ── P2-19 开环:故障期写入 NULL 向量,恢复后可被语义检索(回填) ──
  it('嵌入故障期写入→恢复后可被语义检索到(回填 NULL 向量)', async () => {
    const emb = new ToggleEmbedding()
    const db = openDb(':memory:')
    // 用生产默认地板(0.5),确保无向量时会被地板滤掉、回填后才召回
    const store = new SqliteMemoryStore({ db, embedding: emb, llm: new FakeLLM(['keep']), now: () => 0 })
    emb.fail = true
    const id = await store.record({ personaId: 'coach', kind: 'fact', content: '残局易急躁', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    expect((db.prepare('SELECT embedding FROM memory WHERE id=?').get(Number(id)) as any).embedding).toBeNull()
    emb.fail = false // Ollama 恢复
    // 查询与内容一致 → 回填后 cosine=1 ≥ 地板 → 应召回
    const got = await store.retrieve('coach', '残局易急躁', 5, ['fact'])
    expect(got.map(r => r.content)).toEqual(['残局易急躁'])
    // 且已回写向量(非 NULL)
    expect((db.prepare('SELECT embedding FROM memory WHERE id=?').get(Number(id)) as any).embedding).toBeTruthy()
  })

  it('回填只补 fact/insight,不给 episode 写向量', async () => {
    const emb = new ToggleEmbedding()
    const db = openDb(':memory:')
    const store = new SqliteMemoryStore({ db, embedding: emb, llm: new FakeLLM(['keep']), now: () => 0 })
    const epId = await store.record({ personaId: 'coach', kind: 'episode', content: '这步软了', importance: 1, gameId: null, createdAt: new Date(0).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '当头炮', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    await store.retrieve('coach', '当头炮', 5, ['fact'])
    // episode 的向量始终 NULL(设计如此),回填不应染指
    expect((db.prepare('SELECT embedding FROM memory WHERE id=?').get(Number(epId)) as any).embedding).toBeNull()
  })

  // ── P3:retrieve kinds 缺省语义统一为 ['fact','insight'] ──
  it('retrieve 不传 kinds 时缺省过滤 fact/insight(episode 不混入)', async () => {
    const emb = new ToggleEmbedding()
    const db = openDb(':memory:')
    const store = new SqliteMemoryStore({ db, embedding: emb, llm: new FakeLLM(['keep']), now: () => 0, retrieveMinSim: -1 })
    await store.record({ personaId: 'coach', kind: 'episode', content: '这步软了', importance: 1, gameId: null, createdAt: new Date(0).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '残局易急躁', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    const got = await store.retrieve('coach', '残局', 5) // 不传 kinds
    expect(got.map(r => r.kind)).toEqual(['fact'])
  })
})
