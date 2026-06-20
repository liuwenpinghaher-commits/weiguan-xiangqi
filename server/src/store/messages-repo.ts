import type { DB } from './db.js'

export interface MessageRow {
  id: number
  gameId: number
  personaId: string
  role: string
  text: string
  addressee: string | null
  ts: string
}

export class MessagesRepo {
  constructor(private db: DB) {}

  addMessage(m: {
    gameId: number
    personaId: string
    role: string
    text: string
    addressee?: string | null
    ts: string
  }): number {
    const info = this.db.prepare(
      'INSERT INTO messages (game_id, persona_id, role, text, addressee, ts) VALUES (?,?,?,?,?,?)'
    ).run(m.gameId, m.personaId, m.role, m.text, m.addressee ?? null, m.ts)
    return Number(info.lastInsertRowid)
  }

  getMessages(gameId: number): MessageRow[] {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM messages WHERE game_id=? ORDER BY id ASC'
    ).all(gameId)
    return rows.map(r => ({
      id: r.id,
      gameId: r.game_id,
      personaId: r.persona_id,
      role: r.role,
      text: r.text,
      addressee: r.addressee,
      ts: r.ts,
    }))
  }
}
