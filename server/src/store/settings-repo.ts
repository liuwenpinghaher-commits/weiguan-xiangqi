import type { DB } from './db.js'

export interface PersonaConfig {
  id: string; name: string; isPlayer: boolean; skill: string
  background: string; voiceStyle: string; leaning: string; ttsVoice: string; enabled: boolean
}

/** app_settings(段覆盖 JSON)+ persona_config(逐角色覆盖)的 SQLite 访问层。 */
export class SettingsRepo {
  constructor(private db: DB) {}

  getSection(section: string): Record<string, unknown> | null {
    const row = this.db.prepare('SELECT json FROM app_settings WHERE section=?').get(section) as { json: string } | undefined
    return row ? JSON.parse(row.json) : null
  }

  setSection(section: string, json: Record<string, unknown>, updatedAt: string): void {
    this.db.prepare(
      `INSERT INTO app_settings (section, json, updated_at) VALUES (?,?,?)
       ON CONFLICT(section) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at`,
    ).run(section, JSON.stringify(json), updatedAt)
  }

  personaConfigEmpty(): boolean {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM persona_config').get() as { n: number }
    return row.n === 0
  }

  seedPersonas(personas: PersonaConfig[], updatedAt: string): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO persona_config
       (id, name, is_player, skill, background, voice_style, leaning, tts_voice, enabled, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
    )
    const tx = this.db.transaction((rows: PersonaConfig[]) => {
      for (const p of rows) stmt.run(p.id, p.name, p.isPlayer ? 1 : 0, p.skill, p.background, p.voiceStyle, p.leaning, p.ttsVoice, p.enabled ? 1 : 0, updatedAt)
    })
    tx(personas)
  }

  getAllPersonas(): PersonaConfig[] {
    const rows = this.db.prepare('SELECT * FROM persona_config ORDER BY id').all() as any[]
    return rows.map(r => ({
      id: r.id, name: r.name, isPlayer: !!r.is_player, skill: r.skill,
      background: r.background, voiceStyle: r.voice_style, leaning: r.leaning,
      ttsVoice: r.tts_voice, enabled: !!r.enabled,
    }))
  }

  updatePersona(id: string, patch: Partial<Omit<PersonaConfig, 'id'>>, updatedAt: string): void {
    const cols: string[] = []; const vals: any[] = []
    const map: Record<string, string> = { name: 'name', isPlayer: 'is_player', skill: 'skill', background: 'background', voiceStyle: 'voice_style', leaning: 'leaning', ttsVoice: 'tts_voice', enabled: 'enabled' }
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        const v = (patch as any)[k]
        cols.push(`${col}=?`); vals.push(typeof v === 'boolean' ? (v ? 1 : 0) : v)
      }
    }
    if (!cols.length) return
    cols.push('updated_at=?'); vals.push(updatedAt)
    vals.push(id)
    this.db.prepare(`UPDATE persona_config SET ${cols.join(', ')} WHERE id=?`).run(...vals)
  }

  resetPersona(id: string): void {
    this.db.prepare('DELETE FROM persona_config WHERE id=?').run(id)
  }
}
