import { test, expect } from 'vitest'
import { Position, START_FEN } from './position.js'

test('初始局面轮到红方先走', () => {
  const pos = Position.fromFen(START_FEN)
  expect(pos.sideToMove()).toBe('red')
})

test('初始局面合法着法数大于 20', () => {
  const pos = Position.fromFen(START_FEN)
  const moves = pos.legalMoves()
  // 初始局面红方有 44 手合法着法（已通过 elephantops 真实验证）
  expect(moves.length).toBeGreaterThan(20)
})

test('legalMoves 返回 Pikafish 坐标记法（行 0-9，顶部为 0）', () => {
  const pos = Position.fromFen(START_FEN)
  const moves = pos.legalMoves()
  // 所有着法格式: [a-i][0-9][a-i][0-9]
  const pikaRe = /^[a-i][0-9][a-i][0-9]$/
  for (const m of moves) {
    expect(m).toMatch(pikaRe)
  }
  // 红方炮平中 h7e7 应在合法着法里（Pikafish 记法）
  expect(moves).toContain('h7e7')
})

test('走一手后轮到黑方且 FEN 改变', () => {
  const pos = Position.fromFen(START_FEN)
  // h7e7: 红方右炮平中（Pikafish 记法）
  const next = pos.applyMove('h7e7')
  expect(next.sideToMove()).toBe('black')
  expect(next.fen()).not.toBe(START_FEN)
  // FEN 里应该显示黑方走（b 标志）
  expect(next.fen()).toContain(' b ')
})

test('走完一手后黑方有合法着法', () => {
  const pos = Position.fromFen(START_FEN)
  const next = pos.applyMove('h7e7')
  const blackMoves = next.legalMoves()
  expect(blackMoves.length).toBeGreaterThan(20)
})

test('非法着法 applyMove 抛错', () => {
  const pos = Position.fromFen(START_FEN)
  // e9e5 在初始局面不是合法着法（帅不能这样走）
  expect(() => pos.applyMove('e9e5')).toThrow()
})

test('非法 FEN 字符串 fromFen 抛错', () => {
  expect(() => Position.fromFen('invalid fen string')).toThrow()
})

test('初始局面 isGameOver 返回 over:false', () => {
  const pos = Position.fromFen(START_FEN)
  expect(pos.isGameOver()).toEqual({ over: false })
})

test('fen() 返回的 FEN 可以重新 parse', () => {
  const pos = Position.fromFen(START_FEN)
  const fen = pos.fen()
  const pos2 = Position.fromFen(fen)
  expect(pos2.sideToMove()).toBe('red')
  expect(pos2.legalMoves().length).toBe(pos.legalMoves().length)
})
