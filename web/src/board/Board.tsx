/**
 * 棋盘组件 — 使用 react-xiangqiboard (v0.1.12)
 *
 * 坐标转换假设:
 *   react-xiangqiboard 内部用 Square = "a1".."i10"
 *     行 10 = 黑方（顶部），行 1 = 红方（底部）
 *     这对应 boardOrientation="white"（红方朝下）时的视觉方向
 *
 *   Pikafish 坐标记法: 列 a-i，行 0-9
 *     行 0 = 黑方顶部（FEN 第一行）
 *     行 9 = 红方底部（FEN 最后一行）
 *
 *   转换:
 *     库 Square "e10" → Pikafish: col="e", row = 10 - 10 = 0 → "e0"
 *     库 Square "e1"  → Pikafish: col="e", row = 10 - 1 = 9  → "e9"
 *     即: pikafish_col = square[0], pikafish_row = 10 - parseInt(square.slice(1))
 *
 *   着法字符串 = fromPikafish + toPikafish，例如 "e9e8"（红炮平中路）
 *
 * 注意: 若后端实际行朝向与此假设相反，只需把转换改为
 *   pikafish_row = parseInt(square.slice(1)) - 1
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

/** 将库的 Square（e.g. "e10"）转为 Pikafish 坐标（e.g. "e0"） */
function squareToPikafish(sq: Square): string {
  const col = sq[0]
  const row = parseInt(sq.slice(1), 10)
  return col + String(10 - row)
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
