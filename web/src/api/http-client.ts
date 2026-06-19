const BASE = 'http://localhost:8787'

export const THEME_LABEL: Record<string, string> = {
  ok: '精准', inaccuracy: '缓手', mistake: '错误', blunder: '漏着',
  missed_mate: '错失杀棋', hangs_piece: '丢子',
}

async function jget(path: string) {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

export const diagnoseGame = (id: number) =>
  fetch(`${BASE}/games/${id}/diagnose`, { method: 'POST' }).then((r) => r.json())
export const getDiagnosis = (id: number) => jget(`/games/${id}/diagnosis`)
export const getGrowth = () => jget('/growth')
export const getWeakness = (side: 'red' | 'black') => jget(`/weakness?side=${side}`)
export const getDrills = (id: number) => jget(`/games/${id}/drills`)
export const getCompare = () => jget('/compare')
