export interface ParamField { key: string; label: string; min: number; max: number; step: number; help?: string }

/** 各数值参数段的字段定义(范围与后端 validateSection 钳制范围一致) */
export const PARAM_FIELDS: Record<'chat' | 'engine' | 'diagnose', ParamField[]> = {
  chat: [
    { key: 'minSilenceMs', label: '最短静默(ms)', min: 0, max: 60000, step: 500, help: '两次群聊之间的最短间隔' },
    { key: 'maxPerMin', label: '每分钟上限(条)', min: 0, max: 120, step: 1 },
    { key: 'speakThreshold', label: '发言阈值', min: 0, max: 1, step: 0.05, help: '综合分高于此值才发言' },
    { key: 'jitterWidth', label: '随机抖动宽度', min: 0, max: 2, step: 0.05 },
    { key: 'idleProb', label: '冷场触发概率', min: 0, max: 1, step: 0.05 },
    { key: 'idleIntervalMs', label: '冷场检测间隔(ms)', min: 0, max: 120000, step: 1000 },
    { key: 'reactProb', label: '互相搭话概率', min: 0, max: 1, step: 0.05 },
    { key: 'lenShortP', label: '短句档概率上界', min: 0, max: 1, step: 0.05, help: '<此值出短句' },
    { key: 'lenLongP', label: '中句档概率上界', min: 0, max: 1, step: 0.05, help: '>此值出稍长句' },
    { key: 'coachQueryTension', label: '玩家提问张力', min: 0, max: 1, step: 0.05, help: '玩家提问时的刺激强度(教练必答)' },
    { key: 'idleTension', label: '冷场张力', min: 0, max: 1, step: 0.05 },
    { key: 'playerSelfProb', label: '老黑自评概率', min: 0, max: 1, step: 0.05 },
    { key: 'playerChimeProb', label: '老黑插话概率', min: 0, max: 1, step: 0.05 },
  ],
  engine: [
    { key: 'multipv', label: '候选着法数(MultiPV)', min: 1, max: 10, step: 1 },
    { key: 'movetime', label: '每步思考(ms)', min: 50, max: 5000, step: 50 },
    { key: 'clockInitialSeconds', label: '棋钟初始(秒)', min: 30, max: 3600, step: 30, help: '超时判负' },
    { key: 'clockIncrementSeconds', label: '每步增秒', min: 0, max: 60, step: 1 },
  ],
  diagnose: [
    { key: 'depth', label: '诊断深度', min: 1, max: 30, step: 1 },
  ],
}

/** 脱敏 key 的展示:空/null 显示占位,否则原样(后端已脱敏) */
export function displayMaskedKey(masked: string | null): string {
  return masked && masked.trim() !== '' ? masked : '(未设置)'
}
