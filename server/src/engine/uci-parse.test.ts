import { test, expect } from 'vitest'
import { parseInfoLine, parseBestmove } from './uci-parse.js'

test('parseInfoLine 提取 multipv/score cp/pv', () => {
  const line = 'info depth 12 seldepth 18 multipv 2 score cp -34 nodes 100 pv h2e2 b9c7 i0h0'
  expect(parseInfoLine(line)).toEqual({
    multipv: 2, scoreCp: -34, mate: null, move: 'h2e2',
    pv: ['h2e2', 'b9c7', 'i0h0'],
  })
})

test('parseInfoLine 处理 mate 分数', () => {
  const line = 'info depth 20 multipv 1 score mate 3 pv b0c2 a9b7 c2d4'
  const r = parseInfoLine(line)!
  expect(r.mate).toBe(3)
  expect(r.scoreCp).toBeGreaterThan(29000)
  expect(r.move).toBe('b0c2')
})

test('parseInfoLine 对没有 pv 的行返回 null', () => {
  expect(parseInfoLine('info depth 1 score cp 10 nodes 5')).toBeNull()
  expect(parseInfoLine('info string hashfull 0')).toBeNull()
})

test('parseBestmove 提取着法', () => {
  expect(parseBestmove('bestmove h2e2 ponder b9c7')).toBe('h2e2')
  expect(parseBestmove('bestmove (none)')).toBeNull()
  expect(parseBestmove('info depth 1')).toBeNull()
})
