export interface ChatCfg {
  minSilenceMs: number; maxPerMin: number; speakThreshold: number; jitterWidth: number
  idleProb: number; idleIntervalMs: number; reactProb: number; lenShortP: number; lenLongP: number
  /** 玩家提问(coach_query)刺激的张力(原硬编码 0.9) */
  coachQueryTension: number
  /** 冷场刺激的张力(原硬编码 0.55) */
  idleTension: number
  /** 老黑(player 角色)对自己走子的自评概率(原硬编码 0.6) */
  playerSelfProb: number
  /** 老黑作为当事人对他人刺激的插话概率(原硬编码 0.3) */
  playerChimeProb: number
  /** 同一刺激最多几人发言(默认 1=每步只一个人,避免刷屏;控制台可调高) */
  maxSpeakers: number
}
export interface DirectorModeCfg { maxDropCp: number; targetBand: { low: number; high: number }; strength: number }
export interface DirectorCfg { coach: DirectorModeCfg; humanlike: DirectorModeCfg }
export interface EngineCfg { pikafishPath: string | null; multipv: number; movetime: number; clockInitialSeconds: number; clockIncrementSeconds: number }
export interface DiagnoseCfg { depth: number }
export interface LlmCfg { apiKey: string | null; model: string; baseURL: string | null }

export const DEFAULTS = {
  chat: {
    minSilenceMs: 4000, maxPerMin: 12, speakThreshold: 0.6, jitterWidth: 0.4,
    idleProb: 0.35, idleIntervalMs: 20000, reactProb: 0.3, lenShortP: 0.55, lenLongP: 0.92,
    coachQueryTension: 0.9, idleTension: 0.7, playerSelfProb: 0.6, playerChimeProb: 0.15, maxSpeakers: 1,
  } as ChatCfg,
  director: {
    coach: { maxDropCp: 320, targetBand: { low: -50, high: 80 }, strength: 0.6 },
    humanlike: { maxDropCp: 320, targetBand: { low: -50, high: 80 }, strength: 0.5 },
  } as DirectorCfg,
  engine: { pikafishPath: null, multipv: 5, movetime: 500, clockInitialSeconds: 600, clockIncrementSeconds: 5 } as EngineCfg,
  diagnose: { depth: 12 } as DiagnoseCfg,
  llm: { apiKey: null, model: 'qwen-plus-latest', baseURL: null } as LlmCfg,
}

export type ConfigSection = keyof typeof DEFAULTS
