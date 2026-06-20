import { test, expect } from 'vitest'
import { TempoGuard } from './tempo.js'

test('最小静默间隔内拒绝再次发言', () => {
  let now = 1000
  const g = new TempoGuard({ minSilenceMs: 2000, maxPerMin: 100, now: () => now })
  expect(g.allow()).toBe(true); g.record()
  now = 2500 // 距上次 1.5s < 2s
  expect(g.allow()).toBe(false)
  now = 3100 // 距上次 2.1s ≥ 2s
  expect(g.allow()).toBe(true)
})

test('每分钟发言上限', () => {
  let now = 0
  const g = new TempoGuard({ minSilenceMs: 0, maxPerMin: 3, now: () => now })
  for (let i = 0; i < 3; i++) { expect(g.allow()).toBe(true); g.record(); now += 1000 }
  expect(g.allow()).toBe(false)        // 第 4 次,1 分钟内超限
  now += 61_000
  expect(g.allow()).toBe(true)         // 过了 1 分钟窗口
})
