export interface ChatCfg {
  minSilenceMs: number; maxPerMin: number; speakThreshold: number; jitterWidth: number
  idleProb: number; idleIntervalMs: number; reactProb: number; lenShortP: number; lenLongP: number
  /** 玩家发言刺激的张力(原硬编码 0.9) */
  humanSaidTension: number
  /** 冷场刺激的张力(原硬编码 0.55) */
  idleTension: number
  /** 老黑(player 角色)对自己走子的自评概率(原硬编码 0.6) */
  playerSelfProb: number
  /** 老黑作为当事人对他人刺激的插话概率(原硬编码 0.3) */
  playerChimeProb: number
}
export interface DirectorModeCfg { maxDropCp: number; targetBand: { low: number; high: number }; strength: number }
export interface DirectorCfg { coach: DirectorModeCfg; humanlike: DirectorModeCfg }
export interface EngineCfg { pikafishPath: string | null; multipv: number; movetime: number; clockInitialSeconds: number; clockIncrementSeconds: number }
export interface DiagnoseCfg { depth: number }
export interface LlmCfg { apiKey: string | null; model: string; baseURL: string | null }
export interface TtsCfg {
  /** moss-tts-nano serve HTTP 地址 */
  mossNanoUrl: string
  /** 默认参考音频文件路径 */
  referenceAudio: string
  /** 是否使用流式生成(默认 true);false 则回退 /api/generate */
  streaming: boolean
}

export const DEFAULTS = {
  chat: {
    minSilenceMs: 4000, maxPerMin: 12, speakThreshold: 0.6, jitterWidth: 0.4,
    idleProb: 0.35, idleIntervalMs: 20000, reactProb: 0.3, lenShortP: 0.55, lenLongP: 0.85,
    humanSaidTension: 0.9, idleTension: 0.55, playerSelfProb: 0.6, playerChimeProb: 0.3,
  } as ChatCfg,
  director: {
    coach: { maxDropCp: 320, targetBand: { low: -50, high: 80 }, strength: 0.6 },
    humanlike: { maxDropCp: 320, targetBand: { low: -50, high: 80 }, strength: 0.5 },
  } as DirectorCfg,
  engine: { pikafishPath: null, multipv: 5, movetime: 500, clockInitialSeconds: 600, clockIncrementSeconds: 5 } as EngineCfg,
  diagnose: { depth: 12 } as DiagnoseCfg,
  llm: { apiKey: null, model: 'qwen-plus-latest', baseURL: null } as LlmCfg,
  tts: { mossNanoUrl: 'http://127.0.0.1:18083', referenceAudio: 'assets/tts/reference.wav', streaming: true } as TtsCfg,
}

export type ConfigSection = keyof typeof DEFAULTS
