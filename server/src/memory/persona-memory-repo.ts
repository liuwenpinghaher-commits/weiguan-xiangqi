import type { DB } from '../store/db.js'
import type { PersonaId } from '../types.js'

export interface MemoryRow {
  id: number; personaId: PersonaId; kind: 'episode' | 'fact' | 'insight'
  content: string; gameId: number | null; importance: number; createdAt: string; heat: number
}

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14 // 14 天半衰期

export class PersonaMemoryRepo {
  constructor(private db: DB) {}

  add(m: { personaId: PersonaId; kind: 'episode' | 'fact' | 'insight'; content: string; importance: number; gameId: number | null; createdAt: string }): number {
    const info = this.db.prepare(
      'INSERT INTO persona_memory (persona_id, kind, content, game_id, importance, created_at) VALUES (?,?,?,?,?,?)'
    ).run(m.personaId, m.kind, m.content, m.gameId, m.importance, m.createdAt)
    return Number(info.lastInsertRowid)
  }

  byPersona(personaId: PersonaId): MemoryRow[] {
    return this.rows('SELECT * FROM persona_memory WHERE persona_id=? ORDER BY created_at DESC', [personaId])
  }

  /** 检索注入用:score = recency(指数衰减) + importance/5 + relevance(关键词重合)
   *  kinds 可选:提供时只在这些 kind 中检索;不提供则全部 kind */
  retrieve(personaId: PersonaId, query: string, limit: number, now: () => number, kinds?: Array<'episode' | 'fact' | 'insight'>): MemoryRow[] {
    const rows = kinds ? this.byPersona(personaId).filter(r => kinds.includes(r.kind)) : this.byPersona(personaId)
    const qTokens = tokens(query)
    const t = now()
    const scored = rows.map(r => {
      const ageMs = t - Date.parse(r.createdAt)
      const recency = Math.pow(0.5, ageMs / RECENCY_HALFLIFE_MS)
      const importance = r.importance / 5
      const relevance = overlap(tokens(r.content), qTokens)
      return { r, score: recency + importance + relevance }
    })
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.r)
  }

  private rows(sql: string, args: any[]): MemoryRow[] {
    const rs: any[] = this.db.prepare(sql).all(...args)
    return rs.map(r => ({ id: r.id, personaId: r.persona_id, kind: r.kind, content: r.content,
      gameId: r.game_id, importance: r.importance, createdAt: r.created_at, heat: r.heat }))
  }
}

function tokens(s: string): Set<string> {
  // 中文按字 + 英文按词,够用的最小相关度信号
  return new Set(s.toLowerCase().match(/[一-龥]|[a-z0-9]+/g) ?? [])
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (b.size === 0) return 0
  let n = 0; for (const x of b) if (a.has(x)) n++
  return n / b.size
}
