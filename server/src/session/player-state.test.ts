import { test, expect } from 'vitest'
import { computePlayerState } from './player-state.js'

test('空数组 → winStreak=0, lossStreak=0, lastMoveMs 透传', () => {
  const s = computePlayerState([], 0)
  expect(s.winStreak).toBe(0)
  expect(s.lossStreak).toBe(0)
  expect(s.lastMoveMs).toBe(0)
})

test('最近一胜 → winStreak=1, lossStreak=0', () => {
  const s = computePlayerState(['win'], 100)
  expect(s.winStreak).toBe(1)
  expect(s.lossStreak).toBe(0)
  expect(s.lastMoveMs).toBe(100)
})

test('连续两负 → lossStreak=2, winStreak=0', () => {
  const s = computePlayerState(['loss', 'loss', 'win'], 250)
  expect(s.lossStreak).toBe(2)
  expect(s.winStreak).toBe(0)
  expect(s.lastMoveMs).toBe(250)
})

test('最近 draw → winStreak=0, lossStreak=0', () => {
  const s = computePlayerState(['draw', 'win', 'win'], 0)
  expect(s.winStreak).toBe(0)
  expect(s.lossStreak).toBe(0)
})

test('连续三胜 → winStreak=3', () => {
  const s = computePlayerState(['win', 'win', 'win', 'loss'], 500)
  expect(s.winStreak).toBe(3)
  expect(s.lossStreak).toBe(0)
})

test('胜后负 → winStreak=0, lossStreak=0(最近一胜打断了负连续)', () => {
  // recent[0]='win' → winStreak 从 win 开始数:1; lossStreak 从 loss 开始数 → recent[0]!='loss' → 0
  const s = computePlayerState(['win', 'loss', 'loss'], 0)
  expect(s.winStreak).toBe(1)
  expect(s.lossStreak).toBe(0)
})

test('lastMoveMs 透传任意值', () => {
  expect(computePlayerState([], 9999).lastMoveMs).toBe(9999)
})
