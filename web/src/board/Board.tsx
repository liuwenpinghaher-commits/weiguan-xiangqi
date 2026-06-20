/**
 * 棋盘组件 — 使用 react-xiangqiboard (v0.1.12)
 *
 * 坐标转换假设:
 *   react-xiangqiboard 内部用 Square = "a1".."i10"
 *     行 10 = 黑方（顶部），行 1 = 红方（底部）
 *     这对应 boardOrientation="white"（红方朝下）时的视觉方向
 *
 *   Pikafish 坐标记法: 列 a-i，行 0-9
 *     行 0 = 红方底线（boardOrientation="white" 时视觉在底部）
 *     行 9 = 黑方底线（视觉在顶部）
 *     （2026-06-19 已用真实引擎 perft 验证：rank 0 在红方底线，与后端 position.ts 一致）
 *
 *   转换（与后端 elToPika 对齐）:
 *     库 Square "e1"  (红方底线) → Pikafish row = 1 - 1 = 0 → "e0"
 *     库 Square "e10" (黑方底线) → Pikafish row = 10 - 1 = 9 → "e9"
 *     即: pikafish_col = square[0], pikafish_row = parseInt(square.slice(1)) - 1
 *
 *   着法字符串 = fromPikafish + toPikafish，例如 "h2e2"（炮二平五）
 *
 * 待真机核对: react-xiangqiboard 的 Square 行朝向（row 1 是否真在红方底部）
 *   与 boardOrientation 行为需在浏览器目视确认；若库的 row 朝向与此假设相反，
 *   把下面 squareToPikafish 改回 10 - row 即可（后端记法已固定为标准 Pikafish）。
 */

import { useState } from 'react'
import { Chessboard } from 'react-xiangqiboard'

// Square 类型：列 a-i + 行 1-10，例如 "e1", "a10"
// 与 react-xiangqiboard 的 Square 联合类型对齐
type Square = string

export interface BoardProps {
  fen: string
  onMove: (move: string) => void
  /** 棋盘像素宽度，默认 480 */
  size?: number
  /**
   * 上一步着法的 Pikafish 坐标字符串（如 "b9c7"），长度 4。
   * Board 会高亮 from/to 两格。
   */
  lastMove?: string | null
  /** true 时禁止拖拽（AI 思考期间锁盘） */
  disabled?: boolean
}

/** 将库的 Square（e.g. "e1"）转为 Pikafish 坐标（e.g. "e0"） */
export function squareToPikafish(sq: Square): string {
  const col = sq[0]
  const row = parseInt(sq.slice(1), 10)
  return col + String(row - 1)
}

/** 将 Pikafish 坐标（e.g. "e0"）转为库的 Square（e.g. "e1"） */
export function pikafishToSquare(pika: string): Square {
  const col = pika[0]
  const row = parseInt(pika[1], 10)
  return col + String(row + 1)
}

export function Board({ fen, onMove, size = 480, lastMove, disabled = false }: BoardProps) {
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)

  // 落子回调：用户拖拽落子
  function handlePieceDrop(sourceSquare: Square, targetSquare: Square): boolean {
    if (disabled) return false
    const from = squareToPikafish(sourceSquare)
    const to = squareToPikafish(targetSquare)
    onMove(from + to)
    return true // 乐观接受，若服务端拒绝会发 error 并重置 FEN
  }

  // 点击走法备选（支持点选模式）
  function handleSquareClick(square: Square): void {
    if (disabled) return
    if (selectedSquare === null) {
      setSelectedSquare(square)
    } else {
      if (selectedSquare !== square) {
        const from = squareToPikafish(selectedSquare)
        const to = squareToPikafish(square)
        onMove(from + to)
      }
      setSelectedSquare(null)
    }
  }

  const selectedStyle: Record<string, string | number> = {
    background: 'rgba(255, 255, 0, 0.5)',
    borderRadius: '50%',
  }

  const lastMoveStyle: Record<string, string | number> = {
    background: 'rgba(0, 180, 255, 0.35)',
    boxShadow: 'inset 0 0 0 3px rgba(0, 180, 255, 0.8)',
  }

  // 构建 customSquareStyles：先叠加上一步高亮，再叠加选中高亮（选中优先）
  // 库的 CustomSquareStyles 未在顶层重新导出，用 Record<string,...> 在本地兼容
  const squareStyles: Record<string, Record<string, string | number>> = {}

  if (lastMove && lastMove.length === 4) {
    const fromPika = lastMove.slice(0, 2)
    const toPika = lastMove.slice(2, 4)
    const fromSq = pikafishToSquare(fromPika)
    const toSq = pikafishToSquare(toPika)
    squareStyles[fromSq] = lastMoveStyle
    squareStyles[toSq] = lastMoveStyle
  }

  if (selectedSquare) {
    squareStyles[selectedSquare] = selectedStyle
  }

  // react-xiangqiboard 只识别棋盘段:其 isValidFen 要求 FEN 第 3 段是数字,
  // 标准象棋 FEN 的 "... w - - 0 1" 会因 "-" 段被判 Invalid FEN 并抛错(白屏)。
  // 故只取棋盘部分传入(渲染不需要走子方/回合信息)。
  const boardFen = fen.split(' ')[0]

  return (
    <Chessboard
      position={boardFen}
      onPieceDrop={handlePieceDrop}
      onSquareClick={handleSquareClick}
      boardOrientation="white"
      customSquareStyles={squareStyles as any}
      boardWidth={size}
      arePiecesDraggable={!disabled}
    />
  )
}
