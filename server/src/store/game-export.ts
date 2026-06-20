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
export function validateImport(input: {
  startFen?: string
  moves: string[]
  mode?: string
  result?: string
}): {
  startFen: string
  moves: string[]
  mode: string
  result: 'red' | 'black' | 'draw' | null
} {
  const startFen = input.startFen ?? START_FEN
  const mode = input.mode ?? 'coach'
  const moves = input.moves

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

  return { startFen, moves, mode, result }
}
