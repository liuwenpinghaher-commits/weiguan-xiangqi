import { test, expect } from 'vitest'
import { generateDrills } from './generate-drills.js'
import type { MoveAnnotation } from '../types.js'

const moves = [
  { id: 1, gameId: 1, ply: 1, side: 'red' as const, move: 'm1', fenAfter: 'F1', scoreCp: null, byAi: false },
  { id: 2, gameId: 1, ply: 2, side: 'black' as const, move: 'm2', fenAfter: 'F2', scoreCp: 10, byAi: true },
  { id: 3, gameId: 1, ply: 3, side: 'red' as const, move: 'm3', fenAfter: 'F3', scoreCp: null, byAi: false },
]

test('从人方失误生成训练题,走子前局面=前一手后的 fen', () => {
  const ann: MoveAnnotation[] = [
    { gameId: 1, ply: 1, side: 'red', cpLoss: 10, bestMove: 'b1', phase: 'opening', theme: 'ok' },
    { gameId: 1, ply: 3, side: 'red', cpLoss: 340, bestMove: 'best3', phase: 'midgame', theme: 'blunder' },
  ]
  const drills = generateDrills({ gameId: 1, humanSide: 'red', startFen: 'START', moves, annotations: ann })
  expect(drills).toHaveLength(1)
  expect(drills[0]).toMatchObject({ ply: 3, fen: 'F2', playedMove: 'm3', bestMove: 'best3', cpLoss: 340, theme: 'blunder' })
})

test('第一手失误 → 走子前局面=startFen', () => {
  const ann: MoveAnnotation[] = [{ gameId: 1, ply: 1, side: 'red', cpLoss: 300, bestMove: 'b1', phase: 'opening', theme: 'blunder' }]
  expect(generateDrills({ gameId: 1, humanSide: 'red', startFen: 'START', moves, annotations: ann })[0].fen).toBe('START')
})

test('maxDrills 限制数量,按丢分降序', () => {
  const many: MoveAnnotation[] = [
    { gameId: 1, ply: 1, side: 'red', cpLoss: 100, bestMove: 'b', phase: 'opening', theme: 'inaccuracy' },
    { gameId: 1, ply: 3, side: 'red', cpLoss: 340, bestMove: 'b', phase: 'midgame', theme: 'blunder' },
    { gameId: 1, ply: 5, side: 'red', cpLoss: 200, bestMove: 'b', phase: 'midgame', theme: 'mistake' },
  ]
  const drills = generateDrills({ gameId: 1, humanSide: 'red', startFen: 'S', moves, annotations: many, maxDrills: 2 })
  expect(drills.map((d) => d.cpLoss)).toEqual([340, 200])
})

test('不取对方失误', () => {
  const ann: MoveAnnotation[] = [{ gameId: 1, ply: 2, side: 'black', cpLoss: 500, bestMove: 'b', phase: 'midgame', theme: 'blunder' }]
  expect(generateDrills({ gameId: 1, humanSide: 'red', startFen: 'S', moves, annotations: ann })).toHaveLength(0)
})
