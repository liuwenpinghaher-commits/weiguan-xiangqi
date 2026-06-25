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
import type { ReactElement } from 'react'
import { Chessboard } from 'react-xiangqiboard'

// Square 类型：列 a-i + 行 1-10，例如 "e1", "a10"
// 与 react-xiangqiboard 的 Square 联合类型对齐
type Square = string

// ─── 传统象棋棋子渲染 ───────────────────────────────────────────────────────
// customPieces prop 签名：{ [key: string]: (args) => ReactElement }
// 键名：红方 w 前缀 + K/A/B/N/R/C/P，黑方 b 前缀同

interface PieceRenderArgs {
  isDragging: boolean
  squareWidth: number
  square?: string
}

// 每枚棋子的汉字和字色
const PIECE_CHARS: Record<string, { char: string; color: string }> = {
  wK: { char: '帥', color: '#b3261e' },
  wA: { char: '仕', color: '#b3261e' },
  wB: { char: '相', color: '#b3261e' },
  wN: { char: '傌', color: '#b3261e' },
  wR: { char: '俥', color: '#b3261e' },
  wC: { char: '炮', color: '#b3261e' },
  wP: { char: '兵', color: '#b3261e' },
  bK: { char: '將', color: '#1c1c1c' },
  bA: { char: '士', color: '#1c1c1c' },
  bB: { char: '象', color: '#1c1c1c' },
  bN: { char: '馬', color: '#1c1c1c' },
  bR: { char: '車', color: '#1c1c1c' },
  bC: { char: '砲', color: '#1c1c1c' },
  bP: { char: '卒', color: '#1c1c1c' },
}

/** 生成圆形木色棋子的渲染函数 */
function makePieceRenderer(pieceKey: string): (args: PieceRenderArgs) => ReactElement {
  const info = PIECE_CHARS[pieceKey]
  return function PieceRenderer({ isDragging, squareWidth }: PieceRenderArgs): ReactElement {
    const size = squareWidth * 0.82
    return (
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          background: 'radial-gradient(circle at 38% 32%, #f7e3bd, #e3c187)',
          border: '2px solid #7c4a1e',
          boxShadow: 'inset 0 0 0 2px #b5824a, 0 2px 4px rgba(0,0,0,.35)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: isDragging ? 'scale(1.06)' : 'scale(1)',
          opacity: isDragging ? 0.85 : 1,
          cursor: 'grab',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            fontFamily: "'KaiTi','STKaiti','FangSong','SimSun',serif",
            fontWeight: 700,
            fontSize: squareWidth * 0.5,
            color: info.color,
            lineHeight: 1,
            pointerEvents: 'none',
          }}
        >
          {info.char}
        </span>
      </div>
    )
  }
}

/** 传统象棋棋子映射，传给 Chessboard 的 customPieces prop */
const customPieces: Record<string, (args: PieceRenderArgs) => ReactElement> = Object.fromEntries(
  Object.keys(PIECE_CHARS).map((key) => [key, makePieceRenderer(key)]),
)
// ─────────────────────────────────────────────────────────────────────────────

export interface BoardProps {
  fen: string
  onMove: (move: string) => void
  size?: number
  lastMove?: string | null
  disabled?: boolean
  orientation?: 'red' | 'black'
  legalSquares?: string[]
  preMove?: { from: string; to: string } | null
  onSquareSelect?: (square: string) => void
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

export function Board({ fen, onMove, size = 480, lastMove, disabled = false, orientation = 'red', legalSquares, preMove, onSquareSelect }: BoardProps) {
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
      onSquareSelect?.(squareToPikafish(square))
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

  if (legalSquares && legalSquares.length > 0) {
    for (const pikaSq of legalSquares) {
      const sq = pikafishToSquare(pikaSq)
      if (!squareStyles[sq]) {
        squareStyles[sq] = {
          background: 'radial-gradient(rgba(0,180,80,0.5) 18%, transparent 22%)',
          borderRadius: '50%',
        }
      }
    }
  }

  if (preMove) {
    const fromSq = pikafishToSquare(preMove.from)
    const toSq = pikafishToSquare(preMove.to)
    squareStyles[fromSq] = { background: 'rgba(255,200,0,0.25)', outline: '3px dashed rgba(255,180,0,0.6)' }
    squareStyles[toSq] = { background: 'rgba(255,200,0,0.15)', outline: '3px dashed rgba(255,180,0,0.4)' }
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
      boardOrientation={orientation === 'black' ? 'black' : 'white'}
      customSquareStyles={squareStyles as any}
      boardWidth={size}
      arePiecesDraggable={!disabled}
      customPieces={customPieces as any}
      animationDuration={300}
    />
  )
}
