import type { ConfigSection } from './defaults.js'

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

type Cleaner = (v: unknown) => unknown
const prob: Cleaner = (v) => (typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) : undefined)
const intMin0: Cleaner = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.round(v)) : undefined)
const str: Cleaner = (v) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
// strOrNull:非空字符串透传;null 或空串(含纯空白)→ null(显式清除,存 JSON null);
// 其它类型 → undefined(丢弃)。用于 apiKey/baseURL,使 admin 能把已存的 key 清空。
const strOrNull: Cleaner = (v) => {
  if (v === null) return null
  if (typeof v === 'string') return v.trim() === '' ? null : v
  return undefined
}
const intRange = (lo: number, hi: number): Cleaner => (v) => (typeof v === 'number' && isFinite(v) ? clamp(Math.round(v), lo, hi) : undefined)
const numRange = (lo: number, hi: number): Cleaner => (v) => (typeof v === 'number' && isFinite(v) ? clamp(v, lo, hi) : undefined)

function modeCleaner(v: unknown): unknown {
  if (typeof v !== 'object' || v === null) return undefined
  const m = v as any; const out: any = {}
  if (typeof m.maxDropCp === 'number' && isFinite(m.maxDropCp)) out.maxDropCp = clamp(Math.round(m.maxDropCp), 0, 2000)
  if (m.targetBand && typeof m.targetBand === 'object') {
    const tb: any = {}
    if (typeof m.targetBand.low === 'number' && isFinite(m.targetBand.low)) tb.low = clamp(Math.round(m.targetBand.low), -2000, 2000)
    if (typeof m.targetBand.high === 'number' && isFinite(m.targetBand.high)) tb.high = clamp(Math.round(m.targetBand.high), -2000, 2000)
    // 保证 low ≤ high:两者都给且 low>high 时交换(更稳,不丢用户意图)。
    if ('low' in tb && 'high' in tb && tb.low > tb.high) { const t = tb.low; tb.low = tb.high; tb.high = t }
    if ('low' in tb || 'high' in tb) out.targetBand = tb
  }
  if (typeof m.strength === 'number' && isFinite(m.strength)) out.strength = clamp(m.strength, 0, 1)
  return Object.keys(out).length ? out : undefined
}

const SCHEMA: Record<ConfigSection, Record<string, Cleaner>> = {
  chat: {
    minSilenceMs: intMin0, maxPerMin: intMin0, speakThreshold: prob, jitterWidth: numRange(0, 2),
    idleProb: prob, idleIntervalMs: intMin0, reactProb: prob, lenShortP: prob, lenLongP: prob,
    coachQueryTension: prob, idleTension: prob, playerSelfProb: prob, playerChimeProb: prob,
    maxSpeakers: intRange(1, 3),
  },
  director: { coach: modeCleaner, humanlike: modeCleaner },
  engine: { pikafishPath: (v) => (typeof v === 'string' ? (v.trim() === '' ? null : v) : v === null ? null : undefined), multipv: intRange(1, 10), movetime: intRange(50, 5000), clockInitialSeconds: intRange(30, 3600), clockIncrementSeconds: intRange(0, 60) },
  diagnose: { depth: intRange(1, 30) },
  llm: { apiKey: strOrNull, model: str, baseURL: strOrNull },
}

export function validateSection(section: ConfigSection, patch: Record<string, unknown>): Record<string, unknown> {
  const cleaners = SCHEMA[section]
  if (!cleaners) throw new Error(`unknown config section: ${section}`)
  const out: Record<string, unknown> = {}
  for (const [k, clean] of Object.entries(cleaners)) {
    if (k in patch) {
      const v = clean(patch[k])
      if (v !== undefined) out[k] = v
    }
  }
  return out
}
