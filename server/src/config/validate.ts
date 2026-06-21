import type { ConfigSection } from './defaults.js'

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n))

type Cleaner = (v: unknown) => unknown
const prob: Cleaner = (v) => (typeof v === 'number' && isFinite(v) ? clamp(v, 0, 1) : undefined)
const intMin0: Cleaner = (v) => (typeof v === 'number' && isFinite(v) ? Math.max(0, Math.round(v)) : undefined)
const str: Cleaner = (v) => (typeof v === 'string' && v.trim() !== '' ? v : undefined)
// TTS endpoint:仅允许 https 的阿里云域。服务端会带着 DASHSCOPE_API_KEY 向该 endpoint 发请求,
// 若放任改成任意 URL,等于给了把 key 外带到攻击者服务器的 SSRF 口子。
const httpsAliyun: Cleaner = (v) => {
  if (typeof v !== 'string' || v.trim() === '') return undefined
  try {
    const u = new URL(v)
    if (u.protocol !== 'https:') return undefined
    if (!(u.hostname === 'aliyuncs.com' || u.hostname.endsWith('.aliyuncs.com'))) return undefined
    return v
  } catch { return undefined }
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
    if ('low' in tb || 'high' in tb) out.targetBand = tb
  }
  if (typeof m.strength === 'number' && isFinite(m.strength)) out.strength = clamp(m.strength, 0, 1)
  return Object.keys(out).length ? out : undefined
}

const SCHEMA: Record<ConfigSection, Record<string, Cleaner>> = {
  chat: {
    minSilenceMs: intMin0, maxPerMin: intMin0, speakThreshold: prob, jitterWidth: numRange(0, 2),
    idleProb: prob, idleIntervalMs: intMin0, reactProb: prob, lenShortP: prob, lenLongP: prob,
  },
  director: { coach: modeCleaner, humanlike: modeCleaner },
  engine: { pikafishPath: (v) => (typeof v === 'string' ? v : v === null ? null : undefined), multipv: intRange(1, 10), movetime: intRange(50, 5000) },
  diagnose: { depth: intRange(1, 30) },
  llm: { apiKey: str, model: str, baseURL: str },
  tts: { endpoint: httpsAliyun, model: str },
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
