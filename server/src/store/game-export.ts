/**
 * 棋谱序列化/校验模块
 *
 * 注意：只支持本系统 JSON 往返（Pikafish 坐标记法）。
 * 不解析外部 ICCS/WXF/PGN 格式。
 */
import { Position, START_FEN } from '../rules/position.js'
import { describeMoveZh } from '../rules/describe-move.js'
import type { GameRow, MoveRow } from './games-repo.js'

// ─── 导出对象类型 ───────────────────────────────────────────

export interface GameExport {
  /** 起始 FEN（本系统 Pikafish 坐标） */
  startFen: string
  /** 着法序列，Pikafish 坐标记法 */
  moves: string[]
  /** 中文记谱（可读），与 moves 等长；describeMoveZh 失败时留空串 */
  movesZh: string[]
  /** 局面结果 */
  result: 'red' | 'black' | 'draw' | null
  /** 对局模式 */
  mode: string
  /** 创建时间（ISO 8601） */
  createdAt: string
  /** 人类执方(缺省视为 red,兼容旧导出) */
  humanSide?: 'red' | 'black'
  /** 结束时间(ISO 8601,进行中为 null) */
  endedAt?: string | null
  /** 每手引擎评分(与 moves 等长;人手/无评分为 null) */
  scoreCps?: (number | null)[]
  /** 每手是否 AI 所走(与 moves 等长) */
  byAis?: boolean[]
}

// ─── serializeGame ──────────────────────────────────────────

/**
 * 从 game 行 + moves 行构造导出对象。
 * movesZh 用 describeMoveZh(prevFen, move) 按上一手 fenAfter 推进，
 * 首手用 startFen，失败时留空串（不抛出）。
 */
export function serializeGame(game: GameRow, moves: MoveRow[]): GameExport {
  const moveCodes = moves.map(m => m.move)

  const movesZh: string[] = moves.map((m, i) => {
    // prevFen：首手用 startFen，后续手用上一手 fenAfter
    const prevFen = i === 0 ? game.startFen : moves[i - 1].fenAfter
    try {
      return describeMoveZh(prevFen, m.move)
    } catch {
      return ''
    }
  })

  return {
    startFen: game.startFen,
    moves: moveCodes,
    movesZh,
    result: game.result ?? null,
    mode: game.mode,
    createdAt: game.startedAt,
    humanSide: game.humanSide,
    endedAt: game.endedAt ?? null,
    scoreCps: moves.map(m => m.scoreCp ?? null),
    byAis: moves.map(m => m.byAi),
  }
}

// ─── validateImport ─────────────────────────────────────────

const VALID_RESULTS = new Set<string>(['red', 'black', 'draw'])

/**
 * 校验并解析导入数据。
 * - startFen 缺省用 START_FEN
 * - mode 缺省 'coach'
 * - result 只接受 red/black/draw/null（其他 throw）
 * - 逐手用 Position.applyMove 重放校验；非法手 throw（含第几手）
 */
const VALID_MODES = new Set<string>(['coach', 'humanlike'])
const VALID_SIDES = new Set<string>(['red', 'black'])

export function validateImport(input: {
  startFen?: string
  moves: string[]
  mode?: string
  result?: string
  humanSide?: string
  createdAt?: string
  endedAt?: string | null
  scoreCps?: unknown[]
  byAis?: unknown[]
}): {
  startFen: string
  moves: string[]
  mode: string
  result: 'red' | 'black' | 'draw' | null
  humanSide: 'red' | 'black'
  createdAt: string | null
  endedAt: string | null
  scoreCps: (number | null)[]
  byAis: boolean[]
} {
  const startFen = input.startFen ?? START_FEN
  const moves = input.moves

  // mode 枚举校验(原任意串静默当 coach → 现在非法值明确报错)
  const mode = input.mode ?? 'coach'
  if (!VALID_MODES.has(mode)) throw new Error(`无效的 mode 值 "${mode}",只允许 coach/humanlike`)

  // humanSide:缺省 red(兼容旧导出),非法值报错——修"执黑局导入变执红"
  const humanSide = (input.humanSide ?? 'red') as 'red' | 'black'
  if (!VALID_SIDES.has(humanSide)) throw new Error(`无效的 humanSide 值 "${input.humanSide}",只允许 red/black`)

  // 时间戳:合法可解析则归一为规范 ISO(不再原样存——修 R-6a:非规范串会破坏 started_at 字典序,
  // 进而错切 compare 前后窗;归一为 toISOString 后字典序=时序)。不合法则置 null(导入时用 now 兜底)。
  const toIso = (v?: string | null): string | null =>
    typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null
  const createdAt = toIso(input.createdAt)
  // endedAt:还原原始结束时间(修 R-5:原来丢弃→导入用 now→旧局顶到 recentResults 最前污染战绩)
  const endedAt = toIso(input.endedAt)

  // 逐手评分/AI 标记:与 moves 等长才采用,否则整列丢弃(容错旧格式)
  const scoreCps: (number | null)[] = Array.isArray(input.scoreCps) && input.scoreCps.length === moves.length
    ? input.scoreCps.map(v => (typeof v === 'number' && Number.isFinite(v) ? v : null))
    : moves.map(() => null)
  const byAis: boolean[] = Array.isArray(input.byAis) && input.byAis.length === moves.length
    ? input.byAis.map(v => v === true)
    : moves.map(() => false)

  // 校验 result
  const rawResult = input.result
  let result: 'red' | 'black' | 'draw' | null
  if (rawResult === undefined || rawResult === null || rawResult === '') {
    result = null
  } else if (VALID_RESULTS.has(rawResult)) {
    result = rawResult as 'red' | 'black' | 'draw'
  } else {
    throw new Error(`无效的 result 值 "${rawResult}"，只允许 red/black/draw/null`)
  }

  // 重放校验：逐手走子，非法则 throw
  let pos = Position.fromFen(startFen)
  for (let i = 0; i < moves.length; i++) {
    const move = moves[i]
    try {
      pos = pos.applyMove(move)
    } catch (e) {
      throw new Error(`第 ${i + 1} 手着法非法 "${move}": ${(e as Error).message}`)
    }
  }

  return { startFen, moves, mode, result, humanSide, createdAt, endedAt, scoreCps, byAis }
}
