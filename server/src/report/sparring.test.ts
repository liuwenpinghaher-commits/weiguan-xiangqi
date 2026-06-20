import { test, expect } from 'vitest'
import { prevFenForPly, worstHumanPly } from './sparring.js'
import type { GameRow, MoveRow } from '../store/games-repo.js'

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
const FEN2 = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 2'
const FEN3 = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C3C1c1/9/RNBAKABNR w - - 0 3'

function makeGame(startFen = START): GameRow {
  return { id: 1, startedAt: 't', endedAt: null, mode: 'coach', humanSide: 'red', result: null, startFen }
}

function makeMoves(overrides: Partial<MoveRow>[] = []): MoveRow[] {
  const base: MoveRow[] = [
    { id: 1, gameId: 1, ply: 1, side: 'red', move: 'h2e2', fenAfter: FEN2, scoreCp: 20, byAi: false },
    { id: 2, gameId: 1, ply: 2, side: 'black', move: 'b9c7', fenAfter: FEN3, scoreCp: -30, byAi: true },
  ]
  return base.map((r, i) => ({ ...r, ...(overrides[i] ?? {}) }))
}

// ─── prevFenForPly ───────────────────────────────────────────────────────────

test('prevFenForPly(ply=1) → game.startFen', () => {
  const game = makeGame()
  const moves = makeMoves()
  expect(prevFenForPly(game, moves, 1)).toBe(START)
})

test('prevFenForPly(ply=2) → ply1 的 fenAfter', () => {
  const game = makeGame()
  const moves = makeMoves()
  expect(prevFenForPly(game, moves, 2)).toBe(FEN2)
})

test('prevFenForPly(ply=3) → ply2 的 fenAfter', () => {
  const game = makeGame()
  const moves = makeMoves()
  // ply3 不存在但 ply2 的 fenAfter 可作为前一手
  expect(prevFenForPly(game, moves, 3)).toBe(FEN3)
})

test('prevFenForPly(ply=1) 空 moves 列表 → startFen', () => {
  const game = makeGame()
  expect(prevFenForPly(game, [], 1)).toBe(START)
})

// ─── worstHumanPly ───────────────────────────────────────────────────────────

import type { MoveAnnotation } from '../types.js'

function makeAnnotations(items: Array<{ ply: number; side: 'red' | 'black'; cpLoss: number }>): MoveAnnotation[] {
  return items.map(({ ply, side, cpLoss }) => ({
    gameId: 1, ply, side, cpLoss, bestMove: 'h2e2', phase: 'opening', theme: 'blunder',
  }))
}

test('worstHumanPly 返回人方 cpLoss 最大的 ply', () => {
  const anns = makeAnnotations([
    { ply: 1, side: 'red', cpLoss: 30 },
    { ply: 3, side: 'red', cpLoss: 200 },
    { ply: 5, side: 'red', cpLoss: 80 },
    { ply: 2, side: 'black', cpLoss: 500 }, // AI 方，不算
  ])
  expect(worstHumanPly(anns, 'red')).toBe(3)
})

test('worstHumanPly 无人方标注 → 返回 null', () => {
  const anns = makeAnnotations([{ ply: 2, side: 'black', cpLoss: 300 }])
  expect(worstHumanPly(anns, 'red')).toBeNull()
})

test('worstHumanPly 空标注 → 返回 null', () => {
  expect(worstHumanPly([], 'red')).toBeNull()
})
