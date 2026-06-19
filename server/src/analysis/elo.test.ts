import { test, expect } from 'vitest'
import { accuracyFromAcpl, estimateElo } from './elo.js'

test('准确率随 ACPL 单调下降,0 丢分=100', () => {
  expect(accuracyFromAcpl(0)).toBe(100)
  expect(accuracyFromAcpl(100)).toBeGreaterThan(accuracyFromAcpl(200))
  expect(accuracyFromAcpl(300)).toBeGreaterThan(0)
  expect(accuracyFromAcpl(300)).toBeLessThan(50)
})
test('估算 Elo 单调下降并被钳制在 [600, 2600]', () => {
  expect(estimateElo(0)).toBe(2600)
  expect(estimateElo(100)).toBe(2000)
  expect(estimateElo(200)).toBe(1400)
  expect(estimateElo(50)).toBeGreaterThan(estimateElo(150))
  expect(estimateElo(500)).toBe(600)
  expect(estimateElo(-10)).toBe(2600)
})
