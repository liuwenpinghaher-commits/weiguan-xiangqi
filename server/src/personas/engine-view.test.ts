import { test, expect } from 'vitest'
import { viewScore } from './engine-view.js'

test('strong 档:读数基本等于真值', () => {
  expect(viewScore(120, 'strong', () => 0.5)).toBe(120)
})

test('weak 档:读数被加噪,偏离真值', () => {
  // rng=1 → 取噪声区间上端,明显偏离
  const v = viewScore(120, 'weak', () => 1)!
  expect(v).not.toBe(120)
  expect(Math.abs(v - 120)).toBeGreaterThanOrEqual(100)
})

test('medium 档:噪声幅度介于两者之间', () => {
  const strongDev = Math.abs(viewScore(0, 'strong', () => 1)!)
  const medDev = Math.abs(viewScore(0, 'medium', () => 1)!)
  const weakDev = Math.abs(viewScore(0, 'weak', () => 1)!)
  expect(medDev).toBeGreaterThan(strongDev)
  expect(weakDev).toBeGreaterThan(medDev)
})

test('null 评分原样返回', () => {
  expect(viewScore(null, 'weak', () => 1)).toBeNull()
})
