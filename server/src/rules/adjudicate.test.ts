import { test, expect } from 'vitest'
import { adjudicate } from './adjudicate.js'
import type { RepeatInfo } from './adjudicate.js'

// 辅助：构造 RepeatInfo
function ri(key: string, redChecked = false, blackChecked = false): RepeatInfo {
  return { key, redChecked, blackChecked }
}

// ── 测试 1：60 回合判和 ──────────────────────────────────────────────────────
test('120 plies 无吃子 → draw', () => {
  // history 内容不重要,只看 pliesSinceCapture
  const history: RepeatInfo[] = [ri('A'), ri('B'), ri('C')]
  expect(adjudicate(history, 120)).toEqual({ result: 'draw' })
})

test('119 plies → 不触发 60 回合判和', () => {
  const history: RepeatInfo[] = [ri('A'), ri('B'), ri('C')]
  expect(adjudicate(history, 119)).toBeNull()
})

// ── 测试 2：同一局面 3 次出现,仅红方每次将军 → 红长将 → 红负 (result:'black') ─
test('同 key 出现 3 次且仅红方每次将军 → result:black (红长将红负)', () => {
  // 模拟:k1出现3次,每次都是红方将(redChecked=true),黑方没将
  const history: RepeatInfo[] = [
    ri('k1', true, false),   // 第1次
    ri('other', false, false),
    ri('k1', true, false),   // 第2次
    ri('other2', false, false),
    ri('k1', true, false),   // 第3次
  ]
  expect(adjudicate(history, 0)).toEqual({ result: 'black' })
})

// ── 测试 3：3 次重复双方都不将军 → draw ──────────────────────────────────────
test('同 key 出现 3 次但双方都不将军 → result:draw', () => {
  const history: RepeatInfo[] = [
    ri('k2', false, false),
    ri('other', false, false),
    ri('k2', false, false),
    ri('other2', false, false),
    ri('k2', false, false),
  ]
  expect(adjudicate(history, 0)).toEqual({ result: 'draw' })
})

// ── 测试 4：同 key 出现 3 次仅黑方每次将军 → 黑长将黑负 (result:'red') ─────
test('同 key 出现 3 次且仅黑方每次将军 → result:red (黑长将黑负)', () => {
  const history: RepeatInfo[] = [
    ri('k3', false, true),
    ri('other', false, false),
    ri('k3', false, true),
    ri('other2', false, false),
    ri('k3', false, true),
  ]
  expect(adjudicate(history, 0)).toEqual({ result: 'red' })
})

// ── 测试 5：双方都长将 → draw ─────────────────────────────────────────────────
test('同 key 出现 3 次双方都每次将军 → result:draw', () => {
  const history: RepeatInfo[] = [
    ri('k4', true, true),
    ri('other', false, false),
    ri('k4', true, true),
    ri('other2', false, false),
    ri('k4', true, true),
  ]
  expect(adjudicate(history, 0)).toEqual({ result: 'draw' })
})

// ── 测试 6：未达标 → null ─────────────────────────────────────────────────────
test('同 key 只出现 2 次 → null (不触发)', () => {
  const history: RepeatInfo[] = [
    ri('k5', true, false),
    ri('other', false, false),
    ri('k5', true, false),
  ]
  expect(adjudicate(history, 0)).toBeNull()
})

test('history 内各 key 都不同 + pliesSinceCapture<120 → null', () => {
  const history: RepeatInfo[] = [ri('A'), ri('B'), ri('C'), ri('D')]
  expect(adjudicate(history, 50)).toBeNull()
})
