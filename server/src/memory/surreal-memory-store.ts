import { Surreal, StringRecordId } from 'surrealdb'
import type { MemoryStore, MemoryRecord, MemoryInput, MemoryKind, MemoryListFilter } from './store.js'
import type { EmbeddingProvider } from '../llm/embedding.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId } from '../types.js'
import { judgeMemory } from './memory-judge.js'

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14
// 余弦相似度高于此阈值才对 KNN top-1 候选调用 judge(merge/supersede/keep)。
// 取值权衡:过高 → 真正需要合并/作废的近义更新被漏判,记忆去重/纠错形同虚设;
//          过低 → 不相关记忆也触发 judge,徒增 LLM 调用。
// 0.6 已用真实 text-embedding-v3 标定(见 scripts/calibrate-sim-threshold.ts):
// 无关对相似度 ≤0.50,复述/典型矛盾更新对 ≥0.69——0.6 正落在二者间隙:
// 跳过全部无关对(不浪费 judge),命中所有典型合并/更新;只有"改走完全不同开局"
// 这类语义很远的更新(~0.50)会被当新事实另存(可接受)。judge 自带"相关但不同→keep"
// 分支兜底误合并。可经 deps.simThreshold 覆盖。
const DEFAULT_SIM_THRESHOLD = 0.6
const HNSW_EF = 64 // HNSW 查询时的候选列表大小;v3 的 KNN 算子要求显式给出

export interface SurrealMemoryDeps {
  url: string; namespace: string; database: string; username: string; password: string
  embedding: EmbeddingProvider; llm: LLMProvider; now: () => number
  /** 余弦相似度高于此值才触发 judge;默认 DEFAULT_SIM_THRESHOLD(0.6);测试可注入低值以确定性触发 judge 路径。 */
  simThreshold?: number
  /** 连接(connect+signin+use)超时(ms),默认 4000。超时即 reject,让 ws-server 即时降级而非挂起启动。 */
  connectTimeoutMs?: number
}

/** 把一个 promise 套上超时;超时则以 label reject。无论成败都清掉计时器。 */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(label)), ms) })
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer))
}

const DEFAULT_CONNECT_TIMEOUT_MS = 4000

interface Row {
  id: string; persona_id: string; kind: MemoryKind; content: string
  importance: number; game_id: number | null; created_at: string; superseded_at: string | null
}

export class SurrealMemoryStore implements MemoryStore {
  private db = new Surreal()
  constructor(private deps: SurrealMemoryDeps) {}

  async connect(): Promise<void> {
    const timeoutMs = this.deps.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS
    try {
      await withTimeout((async () => {
        await this.db.connect(this.deps.url)
        await this.db.signin({ username: this.deps.username, password: this.deps.password })
        await this.db.use({ namespace: this.deps.namespace, database: this.deps.database })
      })(), timeoutMs, `SurrealDB 连接超时(${timeoutMs}ms)`)
    } catch (err) {
      // 关掉底层连接以停止客户端的后台重试,避免超时后仍挂着
      try { await this.db.close() } catch { /* ignore */ }
      throw err
    }
    const dim = this.deps.embedding.dimension
    // DDL(建表/HNSW 索引)也纳入超时:大维度索引重建可能卡住,避免启动无限挂起。
    try {
      await withTimeout(this.db.query(`
      DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS persona_id    ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS kind          ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS content       ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS importance    ON memory TYPE int;
      DEFINE FIELD IF NOT EXISTS game_id       ON memory TYPE option<int>;
      DEFINE FIELD IF NOT EXISTS created_at    ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS superseded_at ON memory TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS embedding     ON memory TYPE option<array<float>>;
      DEFINE INDEX IF NOT EXISTS mem_hnsw    ON memory FIELDS embedding HNSW DIMENSION ${dim} DIST COSINE;
      DEFINE INDEX IF NOT EXISTS mem_persona ON memory FIELDS persona_id, kind;
    `), timeoutMs, `SurrealDB 建表/建索引超时(${timeoutMs}ms)`)
    } catch (err) {
      try { await this.db.close() } catch { /* ignore */ }
      throw err
    }
  }

  async close(): Promise<void> { await this.db.close() }

  private async embedOne(text: string): Promise<number[] | null> {
    try { return (await this.deps.embedding.embed([text]))[0] }
    catch (err) { console.warn('[memory] 嵌入失败,降级为无向量:', (err as Error).message); return null }
  }

  /** 把 record id 字符串("memory:xxx")转回可绑定的 RecordId,供 UPDATE/DELETE 复用。 */
  private thing(id: string): StringRecordId { return new StringRecordId(id) }

  async record(e: MemoryInput): Promise<string> {
    if (e.kind === 'episode') return this.insert(e, null)
    const vec = await this.embedOne(e.content)
    if (!vec) return this.insert(e, null)
    // HNSW `<|K,EF|>` 先取 K 个最近邻再后过滤 persona/superseded;K 太小(原为 1)时,
    // 真正该 merge/supersede 的同 persona 候选可能被无关记录占满名额而漏判。放大 K,
    // 后续仍只取过滤后的 top-1(nn)。
    const [nn] = await this.knn(e.personaId, e.kind, vec, this.knnK(1)).catch(() => [] as Awaited<ReturnType<SurrealMemoryStore['knn']>>)
    if (nn && nn.sim >= (this.deps.simThreshold ?? DEFAULT_SIM_THRESHOLD)) {
      // judge 调用抛错(LLM 网络/限流)与解析失败同口径降级为 keep:宁可多存一条,不丢记忆
      const verdict = await judgeMemory(this.deps.llm, nn.row.content, e.content)
        .catch(() => ({ action: 'keep' as const }))
      if (verdict.action === 'merge') {
        const mvec = await this.embedOne(verdict.merged)
        const imp = Math.min(5, nn.row.importance + 1)
        // 合并文本嵌入失败(mvec==null)时,绝不写 embedding 字段——否则 undefined→NONE
        // 会清掉被合并记录的已有向量,该记忆从此对 KNN 语义检索永久不可见。保留旧向量。
        // 并发守卫:judge LLM 期间该行可能被并发作废;只更新仍未作废的行,避免复活已作废记录。
        if (mvec) {
          await this.db.query('UPDATE $id SET content=$c, importance=$imp, embedding=$emb WHERE superseded_at IS NONE',
            { id: this.thing(nn.row.id), c: verdict.merged, imp, emb: mvec })
        } else {
          await this.db.query('UPDATE $id SET content=$c, importance=$imp WHERE superseded_at IS NONE',
            { id: this.thing(nn.row.id), c: verdict.merged, imp })
        }
        return nn.row.id
      }
      if (verdict.action === 'supersede') {
        // 同样守卫:仅作废仍未作废的行(并发已作废则无需重复)。
        await this.db.query('UPDATE $id SET superseded_at=$at WHERE superseded_at IS NONE',
          { id: this.thing(nn.row.id), at: new Date(this.deps.now()).toISOString() })
        return this.insert(e, vec)
      }
    }
    return this.insert(e, vec)
  }

  private async insert(e: MemoryInput, vec: number[] | null): Promise<string> {
    // option<int>/option<array<float>> 字段:SurrealDB 拒绝 NULL,只接受 NONE。
    // surrealdb JS 客户端把 `undefined` 序列化为 NONE,把 `null` 序列化为 NULL → 必须传 undefined。
    const [res] = await this.db.query<[Array<{ id: unknown }>]>(
      'CREATE memory CONTENT { persona_id:$p, kind:$k, content:$c, importance:$imp, game_id:$g, created_at:$ts, superseded_at:NONE, embedding:$emb } RETURN id',
      { p: e.personaId, k: e.kind, c: e.content, imp: e.importance, g: e.gameId ?? undefined, ts: e.createdAt, emb: vec ?? undefined })
    const created = (res as Array<{ id: unknown }> | undefined)?.[0]
    if (!created || created.id == null) {
      throw new Error(`CREATE memory 返回空结果(persona=${e.personaId}, kind=${e.kind}):无法获取新记录 id`)
    }
    return String(created.id)
  }

  /** 放大 HNSW 的 K:取最近邻时先多取(≥32),抵消"先取 K 再后过滤 persona/superseded"造成的占位漏判。 */
  private knnK(want: number): number { return Math.max(want * 8, 32) }

  private async knn(personaId: string, kind: MemoryKind, vec: number[], k: number): Promise<Array<{ row: Row; sim: number }>> {
    // v3 的 KNN 算子语法:`embedding <|K,EF|> $vec`(HNSW 索引);旧的 `<|K|>` 已被移除。
    // vector::distance::knn() 返回该次 KNN 的距离(此处 DIST COSINE → 余弦距离),sim = 1 - dist。
    const [res] = await this.db.query<[any[]]>(
      `SELECT *, vector::distance::knn() AS dist FROM memory
       WHERE persona_id=$p AND kind=$k AND superseded_at IS NONE AND embedding IS NOT NONE
         AND embedding <|${k},${HNSW_EF}|> $vec
       ORDER BY dist ASC`,
      { p: personaId, k: kind, vec })
    return ((res as any[]) ?? []).map((r: any) => ({ row: this.norm(r), sim: 1 - r.dist }))
  }

  async retrieve(personaId: PersonaId, query: string, limit: number, kinds: MemoryKind[] = ['fact', 'insight']): Promise<MemoryRecord[]> {
    if (kinds.length === 0) return []
    const vec = await this.embedOne(query)
    const t = this.deps.now()
    let rows: Array<{ row: Row; sim: number }> = []
    if (vec) {
      for (const k of kinds) rows.push(...await this.knn(personaId, k, vec, this.knnK(limit))) // KNN 取放大后的 K(≥32),抵消后过滤占位漏判;最终结果仍 slice 回 limit

    } else {
      // 嵌入失败降级:不走 KNN,纯按 recency/importance 融合。
      const [res] = await this.db.query<[any[]]>(
        'SELECT * FROM memory WHERE persona_id=$p AND superseded_at IS NONE AND kind IN $kinds',
        { p: personaId, kinds })
      rows = ((res as any[]) ?? []).map((r: any) => ({ row: this.norm(r), sim: 0 }))
    }
    return rows
      .map(({ row, sim }) => {
        // created_at 解析失败(NaN)会让 recency→NaN、score→NaN 打乱排序;失配时把该条当最旧(recency=0)。
        const parsed = Date.parse(row.created_at)
        const recency = Number.isNaN(parsed) ? 0 : Math.pow(0.5, (t - parsed) / RECENCY_HALFLIFE_MS)
        // 加权归一:三项都在 0..1 量纲,语义相似度为主(0.6),时近其次(0.25),重要度微调(0.15)
        return { row, score: 0.6 * sim + 0.25 * recency + 0.15 * (row.importance / 5) }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => this.toRecord(s.row))
  }

  async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
    const wh: string[] = []; const vars: Record<string, unknown> = {}
    if (filter.personaId) { wh.push('persona_id=$p'); vars.p = filter.personaId }
    if (filter.kind) { wh.push('kind=$k'); vars.k = filter.kind }
    if (!filter.includeSuperseded) wh.push('superseded_at IS NONE')
    const clause = wh.length ? 'WHERE ' + wh.join(' AND ') : ''
    const [res] = await this.db.query<[any[]]>(`SELECT * FROM memory ${clause} ORDER BY created_at DESC`, vars)
    return ((res as any[]) ?? []).map((r: any) => this.toRecord(this.norm(r)))
  }

  async update(id: string, patch: { content?: string; importance?: number }): Promise<void> {
    const sets: string[] = []; const vars: Record<string, unknown> = { id: this.thing(id) }
    if (patch.content !== undefined) {
      sets.push('content=$c'); vars.c = patch.content
      const vec = await this.embedOne(patch.content); sets.push('embedding=$emb'); vars.emb = vec ?? undefined
    }
    if (patch.importance !== undefined) { sets.push('importance=$imp'); vars.imp = patch.importance }
    if (!sets.length) return
    await this.db.query(`UPDATE $id SET ${sets.join(', ')}`, vars)
  }

  async remove(id: string): Promise<void> { await this.db.query('DELETE $id', { id: this.thing(id) }) }

  /** 删局级联:清该局全部记忆(admin 删对局时调用),避免 game_id 悬挂孤儿。 */
  async removeByGame(gameId: number): Promise<void> {
    await this.db.query('DELETE memory WHERE game_id = $g', { g: gameId })
  }

  isDegraded(): boolean { return false }

  private norm(r: any): Row {
    return {
      id: String(r.id),
      persona_id: r.persona_id,
      kind: r.kind,
      content: r.content,
      importance: r.importance,
      // option 字段缺省时 SurrealDB 可能返回 undefined 或 null → 一律归一化为 null
      game_id: r.game_id ?? null,
      created_at: r.created_at,
      superseded_at: r.superseded_at ?? null,
    }
  }

  private toRecord(r: Row): MemoryRecord {
    return { id: r.id, personaId: r.persona_id as PersonaId, kind: r.kind, content: r.content,
      importance: r.importance, gameId: r.game_id, createdAt: r.created_at, supersededAt: r.superseded_at }
  }
}
