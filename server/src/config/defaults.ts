export interface ChatCfg {
  minSilenceMs: number; maxPerMin: number; speakThreshold: number; jitterWidth: number
  idleProb: number; idleIntervalMs: number; reactProb: number; lenShortP: number; lenLongP: number
}
export interface DirectorModeCfg { maxDropCp: number; targetBand: { low: number; high: number }; strength: number }
export interface DirectorCfg { coach: DirectorModeCfg; humanlike: DirectorModeCfg }
export interface EngineCfg { pikafishPath: string | null; multipv: number; movetime: number }
export interface DiagnoseCfg { depth: number }
export interface LlmCfg { apiKey: string | null; model: string; baseURL: string | null }
export interface TtsCfg { endpoint: string; model: string }

export const DEFAULTS = {
  chat: {
    minSilenceMs: 4000, maxPerMin: 12, speakThreshold: 0.6, jitterWidth: 0.4,
    idleProb: 0.35, idleIntervalMs: 20000, reactProb: 0.3, lenShortP: 0.55, lenLongP: 0.85,
  } as ChatCfg,
  director: {
    coach: { maxDropCp: 320, targetBand: { low: -50, high: 80 }, strength: 0.6 },
    humanlike: { maxDropCp: 320, targetBand: { low: -50, high: 80 }, strength: 0.5 },
  } as DirectorCfg,
  engine: { pikafishPath: null, multipv: 5, movetime: 500 } as EngineCfg,
  diagnose: { depth: 12 } as DiagnoseCfg,
  llm: { apiKey: null, model: 'qwen-flash', baseURL: null } as LlmCfg,
  tts: { endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', model: 'qwen3-tts-flash' } as TtsCfg,
}

export type ConfigSection = keyof typeof DEFAULTS
