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
// react-xiangqiboard 内部定义但未在顶层重新导出，直接用 string 替代
type Square = string

export interface BoardProps {
  fen: string
  onMove: (move: string) => void
}

/** 将库的 Square（e.g. "e1"）转为 Pikafish 坐标（e.g. "e0"） */
function squareToPikafish(sq: Square): string {
  const col = sq[0]
  const row = parseInt(sq.slice(1), 10)
  return col + String(row - 1)
}

export function Board({ fen, onMove }: BoardProps) {
  const [selectedSquare, setSelectedSquare] = useState<Square | null>(null)

  // 落子回调：用户拖拽落子
  function handlePieceDrop(sourceSquare: Square, targetSquare: Square): boolean {
    const from = squareToPikafish(sourceSquare)
    const to = squareToPikafish(targetSquare)
    onMove(from + to)
    return true // 乐观接受，若服务端拒绝会发 error 并重置 FEN
  }

  // 点击走法备选（支持点选模式）
  function handleSquareClick(square: Square): void {
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

  const highlightStyle: Record<string, string | number> = {
    background: 'rgba(255, 255, 0, 0.5)',
    borderRadius: '50%',
  }

  const customSquareStyles = selectedSquare
    ? { [selectedSquare]: highlightStyle }
    : {}

  return (
    <Chessboard
      position={fen}
      onPieceDrop={handlePieceDrop}
      onSquareClick={handleSquareClick}
      boardOrientation="white"
      customSquareStyles={customSquareStyles}
      boardWidth={480}
    />
  )
}
