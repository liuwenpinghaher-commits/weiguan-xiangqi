import { Surreal, StringRecordId } from 'surrealdb'
import type { MemoryStore, MemoryRecord, MemoryInput, MemoryKind, MemoryListFilter } from './store.js'
import type { EmbeddingProvider } from '../llm/embedding.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId } from '../types.js'
import { judgeMemory } from './memory-judge.js'

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14
// KNN 已把候选限定在「同 persona + 同 kind + 未作废」里,返回的 top-1 就是语义最接近的
// 既有记忆。是否合并/作废交给 LLM judge 决定,这里只用一个很低的相似度地板过滤掉
// 数学上正交/负相关(基本无关)的噪声,避免浪费一次 judge 调用。
// 注意:不能用高阈值(如 0.85)——生产嵌入维度高、近义短句的余弦相似度往往只有 0.5~0.7,
// 高阈值会让"残局易急躁→残局已变稳健"这类真正需要 judge 的更新被直接漏判。
const SIM_FLOOR = -1 // 始终对 top-1 候选调用 judge;judge 才是真正的裁决者
const HNSW_EF = 64 // HNSW 查询时的候选列表大小;v3 的 KNN 算子要求显式给出

export interface SurrealMemoryDeps {
  url: string; namespace: string; database: string; username: string; password: string
  embedding: EmbeddingProvider; llm: LLMProvider; now: () => number
}

interface Row {
  id: string; persona_id: string; kind: MemoryKind; content: string
  importance: number; game_id: number | null; created_at: string; superseded_at: string | null
}

export class SurrealMemoryStore implements MemoryStore {
  private db = new Surreal()
  constructor(private deps: SurrealMemoryDeps) {}

  async connect(): Promise<void> {
    await this.db.connect(this.deps.url)
    await this.db.signin({ username: this.deps.username, password: this.deps.password })
    await this.db.use({ namespace: this.deps.namespace, database: this.deps.database })
    const dim = this.deps.embedding.dimension
    await this.db.query(`
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
    `)
  }

  async close(): Promise<void> { await this.db.close() }

  private async embedOne(text: string): Promise<number[] | null> {
    try { return (await this.deps.embedding.embed([text]))[0] }
    catch { return null }
  }

  /** 把 record id 字符串("memory:xxx")转回可绑定的 RecordId,供 UPDATE/DELETE 复用。 */
  private thing(id: string): StringRecordId { return new StringRecordId(id) }

  async record(e: MemoryInput): Promise<string> {
    if (e.kind === 'episode') return this.insert(e, null)
    const vec = await this.embedOne(e.content)
    if (!vec) return this.insert(e, null)
    const [nn] = await this.knn(e.personaId, e.kind, vec, 1)
    if (nn && nn.sim >= SIM_FLOOR) {
      const verdict = await judgeMemory(this.deps.llm, nn.row.content, e.content)
      if (verdict.action === 'merge') {
        const mvec = await this.embedOne(verdict.merged)
        await this.db.query('UPDATE $id SET content=$c, importance=$imp, embedding=$emb',
          { id: this.thing(nn.row.id), c: verdict.merged, imp: Math.min(5, nn.row.importance + 1), emb: mvec ?? undefined })
        return nn.row.id
      }
      if (verdict.action === 'supersede') {
        await this.db.query('UPDATE $id SET superseded_at=$at',
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
    return String((res as Array<{ id: unknown }>)[0].id)
  }

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
      for (const k of kinds) rows.push(...await this.knn(personaId, k, vec, Math.max(limit, 5)))
    } else {
      // 嵌入失败降级:不走 KNN,纯按 recency/importance 融合。
      const [res] = await this.db.query<[any[]]>(
        'SELECT * FROM memory WHERE persona_id=$p AND superseded_at IS NONE AND kind IN $kinds',
        { p: personaId, kinds })
      rows = ((res as any[]) ?? []).map((r: any) => ({ row: this.norm(r), sim: 0 }))
    }
    return rows
      .map(({ row, sim }) => {
        const recency = Math.pow(0.5, (t - Date.parse(row.created_at)) / RECENCY_HALFLIFE_MS)
        return { row, score: sim + recency + row.importance / 5 }
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
