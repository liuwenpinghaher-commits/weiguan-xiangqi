import { HTTP_BASE as BASE } from './config.js'

export interface PersonaConfig {
  id: string; name: string; isPlayer: boolean; skill: string
  background: string; voiceStyle: string; leaning: string; ttsVoice: string; enabled: boolean
}
export interface MemoryRecord {
  id: string; personaId: string; kind: 'episode' | 'fact' | 'insight'
  content: string; importance: number; gameId: number | null; createdAt: string; supersededAt: string | null
}
export interface GameRow {
  id: number; startedAt: string; endedAt: string | null; mode: string; humanSide: string; result: string | null; startFen: string
}
export interface ChatCfg {
  minSilenceMs: number; maxPerMin: number; speakThreshold: number; jitterWidth: number
  idleProb: number; idleIntervalMs: number; reactProb: number; lenShortP: number; lenLongP: number
  humanSaidTension: number; idleTension: number; playerSelfProb: number; playerChimeProb: number
}
export interface DirectorModeCfg { maxDropCp: number; targetBand: { low: number; high: number }; strength: number }
export interface DirectorCfg { coach: DirectorModeCfg; humanlike: DirectorModeCfg }
export interface EngineCfg { pikafishPath: string | null; multipv: number; movetime: number; clockInitialSeconds: number; clockIncrementSeconds: number }
export interface DiagnoseCfg { depth: number }
export interface LlmCfg { apiKey: string | null; model: string; baseURL: string | null }
export interface TtsCfg { mossNanoUrl: string; referenceAudio: string; streaming: boolean }
export interface ConfigPayload {
  chat: ChatCfg; director: DirectorCfg; engine: EngineCfg; diagnose: DiagnoseCfg
  llm: LlmCfg; tts: TtsCfg; personas: PersonaConfig[]
}
export type ConfigSection = 'chat' | 'director' | 'engine' | 'diagnose' | 'llm' | 'tts'
export interface GameDetail { game: GameRow; moves: any[]; messages: any[] }

async function jget(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}
async function jsend(path: string, method: 'PUT' | 'POST' | 'DELETE', body?: unknown): Promise<any> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

export const getConfig = (): Promise<ConfigPayload> => jget('/admin/config')
export const revealLlmKey = (): Promise<{ apiKey: string | null }> => jget('/admin/config/llm/reveal')
export const putSection = (section: ConfigSection, patch: Record<string, unknown>): Promise<{ ok: true }> =>
  jsend(`/admin/config/${section}`, 'PUT', patch)

export const putPersona = (id: string, patch: Partial<Omit<PersonaConfig, 'id'>>): Promise<{ ok: true }> =>
  jsend(`/admin/personas/${id}`, 'PUT', patch)
export const resetPersona = (id: string): Promise<{ ok: true }> => jsend(`/admin/personas/${id}/reset`, 'POST')

export const listMemory = (q: { personaId?: string; kind?: string; includeSuperseded?: boolean }): Promise<{ degraded: boolean; degradedReason?: string | null; items: MemoryRecord[] }> => {
  const p = new URLSearchParams()
  if (q.personaId) p.set('personaId', q.personaId)
  if (q.kind) p.set('kind', q.kind)
  if (q.includeSuperseded) p.set('includeSuperseded', 'true')
  const qs = p.toString()
  return jget(`/admin/memory${qs ? `?${qs}` : ''}`)
}
export const updateMemory = (id: string, patch: { content?: string; importance?: number }): Promise<{ ok: true }> =>
  jsend(`/admin/memory/${encodeURIComponent(id)}`, 'PUT', patch)
export const deleteMemory = (id: string): Promise<{ ok: true }> =>
  jsend(`/admin/memory/${encodeURIComponent(id)}`, 'DELETE')

export const listGames = (): Promise<GameRow[]> => jget('/admin/games')
export const getGame = (id: number): Promise<GameDetail> => jget(`/admin/games/${id}`)
export const deleteGame = (id: number): Promise<{ ok: true }> => jsend(`/admin/games/${id}`, 'DELETE')

/** 棋谱导入(POST /games/import,与导出 JSON 同构)。返回新 gameId。 */
export async function importGame(data: unknown): Promise<{ gameId: number }> {
  const r = await fetch(`${BASE}/games/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
  })
  if (!r.ok) {
    const body = await r.json().catch(() => ({})) as { error?: string }
    throw new Error(body.error ?? `导入失败 HTTP ${r.status}`)
  }
  return r.json() as Promise<{ gameId: number }>
}
