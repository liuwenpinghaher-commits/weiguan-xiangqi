import type { PersonaId } from '../types.js'

export type MemoryKind = 'episode' | 'fact' | 'insight'

export interface MemoryRecord {
  id: string
  personaId: PersonaId
  kind: MemoryKind
  content: string
  importance: number
  gameId: number | null
  createdAt: string
  supersededAt: string | null
}

export interface MemoryInput {
  personaId: PersonaId
  kind: MemoryKind
  content: string
  importance: number
  gameId: number | null
  createdAt: string
}

export interface MemoryStore {
  /** 写入。episode 廉价 append;fact/insight 触发去重/作废。返回新记录 id */
  record(e: MemoryInput): Promise<string>
  /** 注入用检索。fact/insight 走语义+recency 融合;排除已作废 */
  retrieve(personaId: PersonaId, query: string, limit: number, kinds?: MemoryKind[]): Promise<MemoryRecord[]>
  /** 控制台浏览。默认排除已作废 */
  list(filter: { personaId?: PersonaId; kind?: MemoryKind; includeSuperseded?: boolean }): Promise<MemoryRecord[]>
  /** 控制台编辑。content 变更时重算嵌入(由实现负责) */
  update(id: string, patch: { content?: string; importance?: number }): Promise<void>
  /** 控制台删除 */
  remove(id: string): Promise<void>
}
