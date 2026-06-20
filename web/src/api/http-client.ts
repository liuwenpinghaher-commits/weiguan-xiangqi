import { HTTP_BASE as BASE } from './config.js'

export const THEME_LABEL: Record<string, string> = {
  ok: '精准', inaccuracy: '缓手', mistake: '错误', blunder: '漏着',
  missed_mate: '错失杀棋', hangs_piece: '丢子',
}

async function jget(path: string) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

export interface DrillAttemptResult {
  correct: boolean
  stats: { total: number; correct: number }
}

export interface SparringResult {
  startFen: string | null
  humanSide: 'red' | 'black'
  ply: number | null
}

export const diagnoseGame = (id: number) =>
  fetch(`${BASE}/games/${id}/diagnose`, { method: 'POST' }).then((r) => r.json())
export const getDiagnosis = (id: number) => jget(`/games/${id}/diagnosis`)
export const getGrowth = () => jget('/growth')
export const getWeakness = (side: 'red' | 'black') => jget(`/weakness?side=${side}`)
export const getDrills = (id: number) => jget(`/games/${id}/drills`)
export const getCompare = () => jget('/compare')
export const getSparring = (id: number): Promise<SparringResult> => jget(`/games/${id}/sparring`)

export const postDrillAttempt = (
  id: number,
  ply: number,
  chosenMove: string,
): Promise<DrillAttemptResult> =>
  fetch(`${BASE}/games/${id}/drills/attempt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ply, chosenMove }),
  }).then((r) => {
    if (!r.ok) throw new Error(`/games/${id}/drills/attempt → ${r.status}`)
    return r.json() as Promise<DrillAttemptResult>
  })
