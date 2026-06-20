import { test, expect } from 'vitest'
import { describeMoveZh } from './describe-move.js'

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

test('红炮平中:h2e2 → 红炮二平五', () => {
  expect(describeMoveZh(START, 'h2e2')).toBe('红炮二平五')
})

test('红兵进一:a3a4 → 红兵九进一', () => {
  expect(describeMoveZh(START, 'a3a4')).toBe('红兵九进一')
})

test('黑马跳:b9c7 → 黑马2进3(黑用阿拉伯数字、进为向下)', () => {
  expect(describeMoveZh(START, 'b9c7')).toBe('黑马2进3')
})

test('红马跳:b0c2 → 红马八进七', () => {
  expect(describeMoveZh(START, 'b0c2')).toBe('红马八进七')
})

test('吃子标注:红炮 e2 吃黑卒 e7', () => {
  // 黑卒在 e7(rank7=第3行),红炮在 e2(rank2=第8行)
  const fen = 'rnbakabnr/9/4p4/9/9/9/9/4C4/9/RNBAKABNR w - - 0 1'
  const d = describeMoveZh(fen, 'e2e7')
  expect(d).toContain('炮五进')
  expect(d).toContain('吃')
})

test('非法格式抛错', () => {
  expect(() => describeMoveZh(START, 'zz')).toThrow()
})
