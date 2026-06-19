import { test, expect } from 'vitest'
import { compareWindows } from './compare.js'
import type { GrowthMetric } from '../types.js'

const g = (acpl: number, elo: number, blunders: number): GrowthMetric => ({
  gameId: 0, analyzedAt: 't', humanSide: 'red', acpl, accuracy: 0, estElo: elo,
  openingAcpl: 0, midgameAcpl: 0, endgameAcpl: 0, blunders, mistakes: 0, result: null,
})

test('进步:近段丢分更低、Elo 更高 → delta 与摘要正确', () => {
  const before = [g(150, 1700, 2), g(130, 1820, 1)]
  const after = [g(90, 2060, 1), g(70, 2180, 0)]
  const r = compareWindows(before, after)
  expect(r.before.acpl).toBe(140)
  expect(r.after.acpl).toBe(80)
  expect(r.deltas.acpl).toBe(-60)
  expect(r.deltas.estElo).toBe(360)
  expect(r.summary).toContain('提升')
  expect(r.summary).toContain('降到')
})

test('任一段为空 → 提示样本不足', () => {
  expect(compareWindows([], [g(80, 2000, 0)]).summary).toContain('样本不足')
})
