import { test, expect } from 'vitest'
import { classifyPhase, countMajors } from './phase.js'

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

test('countMajors 数车马炮总数(初始 12)', () => {
  expect(countMajors(START)).toBe(12)
})
test('初始局面属开局', () => {
  expect(classifyPhase(1, START)).toBe('opening')
})
test('手数浅且大子齐 → 仍开局', () => {
  expect(classifyPhase(10, START)).toBe('opening')
})
test('大子充足、过了开局手数 → 中局', () => {
  expect(classifyPhase(30, START)).toBe('midgame')
})
test('大子稀少 → 残局(子力优先于手数)', () => {
  const ending = '4k4/9/9/9/9/9/9/9/9/R3K3R w - - 0 1'
  expect(countMajors(ending)).toBe(2)
  expect(classifyPhase(8, ending)).toBe('endgame')
})
