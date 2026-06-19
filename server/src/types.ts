/** 引擎一条 MultiPV 候选着法,scoreCp 为走子方视角厘兵分 */
export interface EngineLine {
  multipv: number          // 第几候选(1=最优)
  move: string             // 坐标记法,如 "h2e2"
  scoreCp: number          // 厘兵分(走子方视角);若是杀棋则为 mate 映射的极值
  mate: number | null      // n 步杀(正=走子方杀),非杀为 null
  pv: string[]             // 主变着法序列
}

export type GameMode = 'coach' | 'humanlike'

export type Side = 'red' | 'black'

/** 行为代理信号(M1 先放最小集,M2 扩展) */
export interface PlayerState {
  winStreak: number
  lossStreak: number
  lastMoveMs: number       // 上一手用时(毫秒),0 表示未知
}

export interface DirectorContext {
  mode: GameMode
  playerState: PlayerState
  /** 陪练:允许 AI 相对最优着的最大让分(厘兵),防穿帮硬上限 */
  maxDropCp: number
  /** 陪练:AI 目标评分带(走子方=AI 视角),AI 想停留的区间 */
  targetBand: { low: number; high: number }
  /** 拟人:目标强度档 0..1,1=最强;越低越爱挑次优着 */
  strength: number
  /** 注入随机源,范围 [0,1),测试时可固定 */
  rng: () => number
}

export interface DirectorDecision {
  move: string
  reason: string
  chosenLine: EngineLine
}
