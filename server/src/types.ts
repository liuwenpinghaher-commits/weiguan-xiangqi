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

/** 对局阶段 */
export type Phase = 'opening' | 'midgame' | 'endgame'

/** 失误主题(M2 不含"子力失调") */
export type Theme = 'ok' | 'inaccuracy' | 'mistake' | 'blunder' | 'missed_mate' | 'hangs_piece'

/** 逐手诊断标注 */
export interface MoveAnnotation {
  gameId: number
  ply: number
  side: Side
  cpLoss: number
  bestMove: string
  phase: Phase
  theme: Theme
}

/** 逐局成长指标快照 */
export interface GrowthMetric {
  gameId: number
  analyzedAt: string
  humanSide: Side
  acpl: number
  accuracy: number
  estElo: number
  openingAcpl: number
  midgameAcpl: number
  endgameAcpl: number
  blunders: number
  mistakes: number
  result: Side | 'draw' | null
}

/** 训练题:给一个失误局面,作答对照引擎最佳着 */
export interface Drill {
  gameId: number
  ply: number
  fen: string
  bestMove: string
  playedMove: string
  cpLoss: number
  theme: Theme
}

/** 角色 id(可配置;首版预置) */
export type PersonaId = 'player' | 'laopaoer' | 'coach' | 'netizen'

/** 棋力档:决定能看到多深的引擎读数(制造"看走眼") */
export type SkillTier = 'strong' | 'medium' | 'weak'

/** 角色档案 */
export interface Persona {
  id: PersonaId
  name: string
  isPlayer: boolean        // true=AI 棋手,false=观棋者
  skill: SkillTier
  background: string       // 职业/人生经历(喂给 LLM)
  voice: string            // 口吻脾气/口头禅
  leaning: string          // 帮踩倾向(自然语言,非死规则)
}

/** 聊天一条消息(落库 + 推前端) */
export interface ChatLine {
  gameId: number
  personaId: PersonaId
  text: string
  addressee: 'human' | PersonaId | 'all'  // 说给谁
  ts: string
}

/** 触发聊天的刺激 */
export type StimulusKind =
  | 'move' | 'blunder' | 'brilliant' | 'long_think'
  | 'lose_streak' | 'idle' | 'human_said' | 'topic_open'

export interface Stimulus {
  kind: StimulusKind
  gameId: number
  /** 当前局面引擎评分(走子方视角,厘兵);无则 null */
  scoreCp: number | null
  /** 人类刚说的话(kind=human_said 时) */
  humanText?: string
  /** 张力 0..1:越高越该有人说话 */
  tension: number
}
