import type { DB } from '../store/db.js'
import type { MemoryStore, MemoryRecord, MemoryInput, MemoryKind, MemoryListFilter } from './store.js'
import type { EmbeddingProvider } from '../llm/embedding.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId } from '../types.js'
import { judgeMemory } from './memory-judge.js'

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14
// 余弦相似度高于此阈值才对最近邻候选调用 judge(merge/supersede/keep)。
// 2026-07-05 按本地 Ollama bge-m3 重标定(见 scripts/calibrate-sim-threshold.ts,4 类各 5 组中文棋类对实测):
//   复述/细化      min 0.707  mean 0.796
//   相关不同事实   非矛盾项 ≤0.672;唯一 0.724 系"急躁→沉稳"矛盾更新,理应触发 judge
//   同域相关       max 0.702
//   无关           max 0.480
// 0.7 卡在"复述(≥0.707)触发 judge"与"同域相关(≤0.702)/中性相关不同事实(≤0.672)跳过"之间,
// 避免旧 0.6 阈把 ~0.63 的相关不同事实每写一次都多打一次 LLM judge。bge-m3 整体余弦比旧
// text-embedding-v3 偏高,故阈值从 0.6 上调到 0.7。
const DEFAULT_SIM_THRESHOLD = 0.7
// 检索注入相关度地板:低于此 cosine sim 视为与当前话题无关,不注入(persona 记忆稀少时防低相关注入)。
// 同上标定:无关对最高 0.480、同域相关最低 0.564,0.5 落在两者之间——滤掉无关闲话、保住同域相关。
// 旧 0.3 是 text-embedding-v3 的地板,对 bge-m3 太低(无关对 ~0.465 会照样注入),故上调到 0.5。
const DEFAULT_RETRIEVE_MIN_SIM = 0.5

export interface SqliteMemoryDeps {
  db: DB
  embedding: EmbeddingProvider
  llm: LLMProvider
  now: () => number
  /** 余弦相似度高于此值才触发 judge;默认 0.6;测试可注入低值确定性触发 judge。 */
  simThreshold?: number
  /** 检索注入相关度地板(仅向量路径);默认 0.3;测试注入 -1 关闭。 */
  retrieveMinSim?: number
}

interface Row {
  id: string; persona_id: string; kind: MemoryKind; content: string
  importance: number; game_id: number | null; created_at: string; superseded_at: string | null
  embedding: number[] | null
}

/** 余弦相似度。任一向量为空/长度不一致/零向量 → 0(视为不相关)。 */
function cosine(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i] }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

/**
 * 角色长期记忆的 SQLite 实现(替代 SurrealMemoryStore)。
 * - 存储:memory 表,向量以 JSON 文本存 embedding 列。
 * - 语义检索:候选行在 JS 里逐条算余弦(数据量小,O(n) 完全够);沿用融合打分 + 相关度地板。
 * - 去重:写 fact/insight 时对同 persona/kind 的最近邻算余弦,超阈值调 LLM judge 决定 merge/supersede/keep。
 * - 始终持久(单一 SQLite),不再有连接失败→内存降级;仅嵌入失败时语义检索退回 recency。
 */
export class SqliteMemoryStore implements MemoryStore {
  private embeddingHealthy = true
  constructor(private deps: SqliteMemoryDeps) {}

  private async embedOne(text: string): Promise<number[] | null> {
    try {
      const v = (await this.deps.embedding.embed([text]))[0]
      this.embeddingHealthy = true
      return v
    } catch (err) {
      this.embeddingHealthy = false
      console.warn('[memory] 嵌入失败,降级为无向量:', (err as Error).message); return null
    }
  }

  private rowFrom(r: any): Row {
    let emb: number[] | null = null
    if (typeof r.embedding === 'string' && r.embedding) {
      try { const p = JSON.parse(r.embedding); if (Array.isArray(p)) emb = p as number[] } catch { /* 坏 JSON 当无向量 */ }
    }
    return {
      id: String(r.id), persona_id: r.persona_id, kind: r.kind, content: r.content,
      importance: r.importance, game_id: r.game_id ?? null,
      created_at: r.created_at, superseded_at: r.superseded_at ?? null, embedding: emb,
    }
  }
  private toRecord(r: Row): MemoryRecord {
    return { id: r.id, personaId: r.persona_id as PersonaId, kind: r.kind, content: r.content,
      importance: r.importance, gameId: r.game_id, createdAt: r.created_at, supersededAt: r.superseded_at }
  }

  async record(e: MemoryInput): Promise<string> {
    // episode 一律 append 无向量:当前无消费方(不参与检索/去重),纯写入空转,
    // 保留供未来反思(reflection)素材;故不嵌入、不回填。
    if (e.kind === 'episode') return this.insert(e, null)
    const vec = await this.embedOne(e.content)
    if (!vec) return this.insert(e, null)

    // 本次嵌入成功=服务健康 → 顺带回填该 persona 故障期遗留的 NULL 向量记忆(P2-19 开环)。
    await this.backfillNullEmbeddings(e.personaId)

    // 最近邻:同 persona/kind、未作废、有向量的行里算余弦取 top-1
    const rows = this.deps.db.prepare(
      'SELECT * FROM memory WHERE persona_id=? AND kind=? AND superseded_at IS NULL AND embedding IS NOT NULL'
    ).all(e.personaId, e.kind).map(r => this.rowFrom(r))
    let nn: { row: Row; sim: number } | null = null
    for (const row of rows) {
      const sim = cosine(vec, row.embedding!)
      if (!nn || sim > nn.sim) nn = { row, sim }
    }

    if (nn && nn.sim >= (this.deps.simThreshold ?? DEFAULT_SIM_THRESHOLD)) {
      // judge 调用抛错与解析失败同口径降级为 keep:宁可多存一条,不丢记忆
      const verdict = await judgeMemory(this.deps.llm, nn.row.content, e.content)
        .catch(() => ({ action: 'keep' as const }))
      if (verdict.action === 'merge') {
        const mvec = await this.embedOne(verdict.merged)
        const imp = Math.min(5, nn.row.importance + 1)
        // 合并文本嵌入失败时不动 embedding 列,保留旧向量(否则该记忆对语义检索永久不可见)。
        // 并发守卫:仅更新仍未作废的行。
        if (mvec) {
          this.deps.db.prepare('UPDATE memory SET content=?, importance=?, embedding=? WHERE id=? AND superseded_at IS NULL')
            .run(verdict.merged, imp, JSON.stringify(mvec), Number(nn.row.id))
        } else {
          this.deps.db.prepare('UPDATE memory SET content=?, importance=? WHERE id=? AND superseded_at IS NULL')
            .run(verdict.merged, imp, Number(nn.row.id))
        }
        return nn.row.id
      }
      if (verdict.action === 'supersede') {
        this.deps.db.prepare('UPDATE memory SET superseded_at=? WHERE id=? AND superseded_at IS NULL')
          .run(new Date(this.deps.now()).toISOString(), Number(nn.row.id))
        return this.insert(e, vec)
      }
    }
    return this.insert(e, vec)
  }

  private insert(e: MemoryInput, vec: number[] | null): string {
    const info = this.deps.db.prepare(
      'INSERT INTO memory (persona_id, kind, content, importance, game_id, created_at, superseded_at, embedding) VALUES (?,?,?,?,?,?,NULL,?)'
    ).run(e.personaId, e.kind, e.content, e.importance, e.gameId ?? null, e.createdAt, vec ? JSON.stringify(vec) : null)
    return String(info.lastInsertRowid)
  }

  /**
   * 回填故障期写入的 NULL 向量记忆(P2-19 开环):嵌入服务恢复后补算并回写向量。
   * 只补 fact/insight——episode 设计上就是无向量(不参与检索),不染指。
   * 单条嵌入失败=服务又掉线,立即停手(剩余留待下次),避免整轮阻塞。
   */
  private async backfillNullEmbeddings(personaId: PersonaId): Promise<void> {
    const rows = this.deps.db.prepare(
      "SELECT id, content FROM memory WHERE persona_id=? AND kind != 'episode' AND embedding IS NULL AND superseded_at IS NULL"
    ).all(personaId) as Array<{ id: number; content: string }>
    for (const r of rows) {
      const vec = await this.embedOne(r.content)
      if (!vec) return // 又掉线,余下留到下次
      this.deps.db.prepare('UPDATE memory SET embedding=? WHERE id=? AND embedding IS NULL')
        .run(JSON.stringify(vec), r.id)
    }
  }

  async retrieve(personaId: PersonaId, query: string, limit: number, kinds: MemoryKind[] = ['fact', 'insight']): Promise<MemoryRecord[]> {
    if (kinds.length === 0) return []
    const vec = await this.embedOne(query)
    const t = this.deps.now()

    // 嵌入服务已恢复(query 成功嵌入)→ 顺带回填故障期写入的 NULL 向量记忆(P2-19 开环)。
    // 否则那些记忆会被相关度地板永久过滤、也不参与去重最近邻,等于永久失踪。
    if (vec) await this.backfillNullEmbeddings(personaId)

    const placeholders = kinds.map(() => '?').join(',')
    const all = this.deps.db.prepare(
      `SELECT * FROM memory WHERE persona_id=? AND superseded_at IS NULL AND kind IN (${placeholders})`
    ).all(personaId, ...kinds).map(r => this.rowFrom(r))

    let scored: Array<{ row: Row; sim: number }>
    if (vec) {
      // 语义路径:逐条算余弦 + 相关度地板(挡近乎无关的注入)
      const floor = this.deps.retrieveMinSim ?? DEFAULT_RETRIEVE_MIN_SIM
      scored = all
        .map(row => ({ row, sim: row.embedding ? cosine(vec, row.embedding) : 0 }))
        .filter(s => s.sim >= floor)
    } else {
      // 嵌入失败降级:不算余弦,纯 recency/importance 融合(sim=0),不套地板以免全滤掉
      scored = all.map(row => ({ row, sim: 0 }))
    }

    return scored
      .map(({ row, sim }) => {
        const parsed = Date.parse(row.created_at)
        const recency = Number.isNaN(parsed) ? 0 : Math.pow(0.5, (t - parsed) / RECENCY_HALFLIFE_MS)
        // 加权归一:语义为主(0.6),时近其次(0.25),重要度微调(0.15)
        return { row, score: 0.6 * sim + 0.25 * recency + 0.15 * (row.importance / 5) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => this.toRecord(s.row))
  }

  async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
    const wh: string[] = []; const vars: unknown[] = []
    if (filter.personaId) { wh.push('persona_id=?'); vars.push(filter.personaId) }
    if (filter.kind) { wh.push('kind=?'); vars.push(filter.kind) }
    if (!filter.includeSuperseded) wh.push('superseded_at IS NULL')
    const clause = wh.length ? 'WHERE ' + wh.join(' AND ') : ''
    return this.deps.db.prepare(`SELECT * FROM memory ${clause} ORDER BY created_at DESC`)
      .all(...vars).map(r => this.toRecord(this.rowFrom(r)))
  }

  async update(id: string, patch: { content?: string; importance?: number }): Promise<void> {
    const sets: string[] = []; const vars: unknown[] = []
    if (patch.content !== undefined) {
      sets.push('content=?'); vars.push(patch.content)
      const vec = await this.embedOne(patch.content)
      // 重嵌入失败(Ollama 掉线)时不写 embedding 列,保留旧向量——与 merge 路径同策略。
      // 若无条件写 NULL,则该记忆在健康态检索会被相关度地板永久过滤(P2-19)。
      // 旧向量虽对新文本略微陈旧,但远胜于无向量;下次成功编辑会自动纠正。
      if (vec) { sets.push('embedding=?'); vars.push(JSON.stringify(vec)) }
    }
    if (patch.importance !== undefined) { sets.push('importance=?'); vars.push(patch.importance) }
    if (!sets.length) return
    vars.push(Number(id))
    this.deps.db.prepare(`UPDATE memory SET ${sets.join(', ')} WHERE id=?`).run(...vars as any[])
  }

  async remove(id: string): Promise<void> {
    this.deps.db.prepare('DELETE FROM memory WHERE id=?').run(Number(id))
  }

  /** 删局级联:清该局全部记忆,避免 game_id 悬挂孤儿。 */
  async removeByGame(gameId: number): Promise<void> {
    this.deps.db.prepare('DELETE FROM memory WHERE game_id=?').run(gameId)
  }

  // SQLite 始终持久,不存在"未连接"降级;仅嵌入持续失败=语义检索失效才算降级。
  isDegraded(): boolean { return !this.embeddingHealthy }
  degradedReason(): string | null {
    return this.embeddingHealthy ? null : '嵌入服务异常:语义检索暂不可用,当前仅按时间/重要度召回(记忆仍持久化)'
  }
}
