import { test, expect } from 'vitest'
import { selectMove } from './director.js'
import type { EngineLine, DirectorContext } from '../types.js'

const lines: EngineLine[] = [
  { multipv: 1, move: 'b0c2', scoreCp: 300, mate: null, pv: ['b0c2'] },
  { multipv: 2, move: 'h2e2', scoreCp: 40,  mate: null, pv: ['h2e2'] },
  { multipv: 3, move: 'a0a1', scoreCp: -500, mate: null, pv: ['a0a1'] },
]

const baseCoach: DirectorContext = {
  mode: 'coach',
  playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 },
  maxDropCp: 320,
  targetBand: { low: -50, high: 80 },
  strength: 0.5,
  rng: () => 0,
}

test('陪练:挑落在目标带内的着法,而非最优大优着', () => {
  const d = selectMove(lines, baseCoach)
  expect(d.move).toBe('h2e2')
})

test('防穿帮:绝不选让分超过 maxDropCp 的臭着', () => {
  const d = selectMove(lines, baseCoach)
  expect(d.move).not.toBe('a0a1')
})

test('防穿帮:若所有次优都超限,则回退到最优着(不送)', () => {
  const tight: DirectorContext = { ...baseCoach, maxDropCp: 50 }
  const d = selectMove(lines, tight)
  expect(d.move).toBe('b0c2')
})

test('连败:目标带自动下调(更让玩家),仍守防穿帮', () => {
  const losing: DirectorContext = { ...baseCoach, playerState: { winStreak: 0, lossStreak: 3, lastMoveMs: 0 } }
  const d = selectMove(lines, losing)
  expect(d.move).toBe('h2e2')
  expect(d.reason).toMatch(/连败|让/)
})

test('杀棋例外:能将死时不放水,直接取杀', () => {
  const mateLines: EngineLine[] = [
    { multipv: 1, move: 'c3c4', scoreCp: 29997, mate: 3, pv: ['c3c4'] },
    { multipv: 2, move: 'h2e2', scoreCp: 30, mate: null, pv: ['h2e2'] },
  ]
  const d = selectMove(mateLines, baseCoach)
  expect(d.move).toBe('c3c4')
})
