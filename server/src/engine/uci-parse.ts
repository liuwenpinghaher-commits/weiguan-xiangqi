import type { EngineLine } from '../types.js'

export const MATE_BASE = 30000

/** 解析一行 `info ... multipv ... score ... pv ...`;非候选行返回 null */
export function parseInfoLine(line: string): EngineLine | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'info') return null
  const pvIdx = t.indexOf('pv')
  if (pvIdx === -1 || pvIdx === t.length - 1) return null

  const num = (key: string): number | null => {
    const i = t.indexOf(key)
    return i !== -1 && i + 1 < t.length ? Number(t[i + 1]) : null
  }

  const multipv = num('multipv') ?? 1
  const pv = t.slice(pvIdx + 1)

  let scoreCp = 0
  let mate: number | null = null
  const scoreIdx = t.indexOf('score')
  if (scoreIdx !== -1) {
    const kind = t[scoreIdx + 1]
    const val = Number(t[scoreIdx + 2])
    if (kind === 'mate') {
      mate = val
      scoreCp = val >= 0 ? MATE_BASE - val : -MATE_BASE - val
    } else if (kind === 'cp') {
      scoreCp = val
    }
  }
  return { multipv, move: pv[0], scoreCp, mate, pv }
}

/** 解析 `bestmove xxx`;无着法返回 null */
export function parseBestmove(line: string): string | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'bestmove') return null
  const m = t[1]
  return !m || m === '(none)' ? null : m
}
