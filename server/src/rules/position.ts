/**
 * 象棋规则适配层 —— 使用 elephantops@0.1.1 实现
 *
 * 真实验证的 elephantops API（2026-06-19 spike）：
 *   - parseFen(fen: string): Result<Setup, FenError>  — 解析 FEN，用 .unwrap() 取值
 *   - makeFen(setup: Setup): string  — 生成 FEN
 *   - Xiangqi.fromSetup(setup): Result<Xiangqi, PositionError>  — 从 Setup 构建合法局面
 *   - pos.turn: Color ('red' | 'black')  — 当前行棋方
 *   - pos.allDests(): Map<Square, SquareSet>  — 返回所有合法着法(from→toSet)
 *   - pos.isEnd(): boolean  — 游戏是否结束
 *   - pos.isCheckmate(): boolean  — 是否将死
 *   - pos.isStalemate(): boolean  — 是否困毙
 *   - pos.outcome(): Outcome | undefined  — { winner: Color | undefined }
 *   - pos.play(move: Move): void  — 原地走子（需先 clone）
 *   - pos.clone(): Xiangqi  — 克隆局面
 *   - pos.toSetup(): Setup  — 转为 Setup 供 makeFen 使用
 *   - makeUci({ from, to }): string  — 着法转字符串（elephantops 坐标记法）
 *   - parseUci(str): Move | undefined  — 字符串转着法对象
 *
 * 坐标系差异（需要做转换）：
 *   elephantops 记法: file[a-i] + rank[1-10]（行 1 在红方底线，行 10 在黑方底线）
 *   Pikafish 记法:   file[a-i] + rank[0-9]（行 0 在红方底线，行 9 在黑方底线）
 *
 *   转换公式（2026-06-19 用真实 Pikafish `go perft 1` 对比初始局面验证）：
 *     pikafish_rank = elephantops_rank - 1
 *     elephantops_rank = pikafish_rank + 1
 *   （file 列字母两边一致，不转换。）
 *
 *   示例（已与引擎 bestmove 记法核对一致）：
 *     elephantops "h3e3" → Pikafish "h2e2"（红方右炮平中，即炮二平五）
 *     elephantops "b3e3" → Pikafish "b2e2"（红方左炮平中）
 *     elephantops "a1a2" → Pikafish "a0a1"（红方车前进）
 *
 *   历史坑（OPEN-ISSUES #1，已修）：曾用 `10 - rank` 把红炮算成 h7，与引擎
 *   的 h2 整体翻转；因适配层 legalMoves/applyMove 内部自洽，纯逻辑单测发现不了，
 *   只有接真实 Pikafish 时才暴露为 "illegal move"。
 *
 * 初始局面合法着法数：44（真实验证值，与 Pikafish perft 1 一致）
 */

import type { Side } from '../types.js'
import { parseFen, makeFen } from 'elephantops/fen'
import { Xiangqi } from 'elephantops/xiangqi'
import { makeUci, parseUci } from 'elephantops/util'

export const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

/**
 * 将 elephantops UCI 记法转换为 Pikafish 坐标记法
 * elephantops: "h3e3" → Pikafish: "h2e2"
 * elephantops 行号 1-10（红方底线为 1），Pikafish 行号 0-9（红方底线为 0）
 */
function elToPika(move: string): string {
  // elephantops 行号可能是两位数（"10"），用贪婪匹配
  const m = move.match(/^([a-i])(\d+)([a-i])(\d+)$/)
  if (!m) throw new Error(`Invalid elephantops move: ${move}`)
  const [, f1, r1str, f2, r2str] = m
  const pr1 = parseInt(r1str) - 1
  const pr2 = parseInt(r2str) - 1
  return `${f1}${pr1}${f2}${pr2}`
}

/**
 * 将 Pikafish 坐标记法转换为 elephantops UCI 记法
 * Pikafish: "h2e2" → elephantops: "h3e3"
 * Pikafish 行号固定为单个数字 0-9
 */
function pikaToEl(move: string): string {
  const m = move.match(/^([a-i])([0-9])([a-i])([0-9])$/)
  if (!m) throw new Error(`Invalid Pikafish move (must be [a-i][0-9][a-i][0-9]): ${move}`)
  const [, f1, r1, f2, r2] = m
  const er1 = parseInt(r1) + 1
  const er2 = parseInt(r2) + 1
  return `${f1}${er1}${f2}${er2}`
}

export class Position {
  private constructor(private readonly _pos: Xiangqi) {}

  /**
   * 从 FEN 字符串构建局面。非法 FEN 抛 Error。
   */
  static fromFen(fen: string): Position {
    const setupResult = parseFen(fen)
    if (setupResult.isErr) {
      throw new Error(`Invalid FEN "${fen}": ${setupResult.error.message}`)
    }
    const posResult = Xiangqi.fromSetup(setupResult.value)
    if (posResult.isErr) {
      throw new Error(`Illegal position from FEN "${fen}": ${posResult.error.message}`)
    }
    return new Position(posResult.value)
  }

  /** 返回当前局面的 FEN 字符串 */
  fen(): string {
    return makeFen(this._pos.toSetup())
  }

  /** 返回当前行棋方 */
  sideToMove(): Side {
    return this._pos.turn as Side
  }

  /**
   * 返回所有合法着法，Pikafish 坐标记法（如 "h2e2"）
   * 坐标系：列 a-i，行 0-9（0 为红方底线，9 为黑方底线）
   */
  legalMoves(): string[] {
    const dests = this._pos.allDests()
    const moves: string[] = []
    for (const [from, toSet] of dests) {
      for (const to of toSet) {
        const elMove = makeUci({ from, to })
        moves.push(elToPika(elMove))
      }
    }
    return moves
  }

  /**
   * 走一手棋，返回新局面。
   * move 必须是 Pikafish 坐标记法（如 "h2e2"）。
   * 若 move 不在合法着法中，抛 Error。
   */
  applyMove(move: string): Position {
    // 先验证着法格式
    const elMoveStr = pikaToEl(move)
    const moveObj = parseUci(elMoveStr)
    if (!moveObj) {
      throw new Error(`Cannot parse move: ${move} (elephantops: ${elMoveStr})`)
    }

    // 验证是否在合法着法中
    const ctx = this._pos.ctx()
    if (!this._pos.isLegal(moveObj, ctx)) {
      throw new Error(`Illegal move: ${move}`)
    }

    const newPos = this._pos.clone()
    newPos.play(moveObj)
    return new Position(newPos)
  }

  /**
   * 局面去重键：取 FEN 的"棋盘 + 走子方"两段，忽略步数计数。
   * 用于三次重复局面检测。
   * 示例："rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w"
   */
  key(): string {
    return this.fen().split(' ').slice(0, 2).join(' ')
  }

  /**
   * 当前走子方是否被将军。
   * 使用 elephantops Position 基类的 isCheck() 方法（实测 API：2026-06-20）。
   */
  inCheck(): boolean {
    return this._pos.isCheck()
  }

  /**
   * 判断游戏是否结束
   * 返回 { over: false } 或 { over: true, result: Side | 'draw' }
   */
  isGameOver(): { over: boolean; result?: Side | 'draw' } {
    if (!this._pos.isEnd()) {
      return { over: false }
    }
    const outcome = this._pos.outcome()
    if (!outcome) {
      // isEnd() 为 true 但 outcome 为 undefined（理论上不应发生）
      return { over: true, result: 'draw' }
    }
    if (outcome.winner === undefined) {
      return { over: true, result: 'draw' }
    }
    return { over: true, result: outcome.winner as Side }
  }
}
