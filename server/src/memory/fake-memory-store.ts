import type { MemoryStore, MemoryRecord, MemoryInput, MemoryKind, MemoryListFilter } from './store.js'
import type { PersonaId } from '../types.js'

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14 // 14 天,与原实现一致

/** 内存测试双:append-only,不做语义去重(语义在 SurrealMemoryStore 测)。
 *  retrieve 用 recency+importance(= 降级路径行为),便于断言排序。 */
export class FakeMemoryStore implements MemoryStore {
  private rows: MemoryRecord[] = []
  private seq = 0
  constructor(private now: () => number = () => Date.now()) {}

  async record(e: MemoryInput): Promise<string> {
    const id = `mem:${++this.seq}`
    this.rows.push({ ...e, id, supersededAt: null })
    return id
  }

  async retrieve(personaId: PersonaId, _query: string, limit: number, kinds?: MemoryKind[]): Promise<MemoryRecord[]> {
    const t = this.now()
    return this.rows
      .filter(r => r.personaId === personaId && !r.supersededAt && (!kinds || kinds.includes(r.kind)))
      .map(r => {
        const recency = Math.pow(0.5, (t - Date.parse(r.createdAt)) / RECENCY_HALFLIFE_MS)
        return { r, score: recency + r.importance / 5 }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.r)
  }

  async list(filter: MemoryListFilter): Promise<MemoryRecord[]> {
    return this.rows.filter(r =>
      (!filter.personaId || r.personaId === filter.personaId) &&
      (!filter.kind || r.kind === filter.kind) &&
      (filter.includeSuperseded || !r.supersededAt))
  }

  async update(id: string, patch: { content?: string; importance?: number }): Promise<void> {
    const row = this.rows.find(r => r.id === id)
    if (!row) return
    if (patch.content !== undefined) row.content = patch.content
    if (patch.importance !== undefined) row.importance = patch.importance
  }

  async removeByGame(gameId: number): Promise<void> {
    this.rows = this.rows.filter(r => r.gameId !== gameId)
  }

  /** Fake = 降级态(不持久、无语义检索),控制台应提示 */
  isDegraded(): boolean { return true }

  async remove(id: string): Promise<void> {
    this.rows = this.rows.filter(r => r.id !== id)
  }

  /** 测试辅助:标记作废(生产由 SurrealMemoryStore 的 judge 路径触发) */
  async markSuperseded(id: string, at: string): Promise<void> {
    const row = this.rows.find(r => r.id === id)
    if (row) row.supersededAt = at
  }
}
