/**
 * TDD — game-export 纯序列化/校验模块
 *
 * 注意：只支持本系统 JSON 往返（Pikafish 坐标记法）。
 * 不解析外部 ICCS/WXF/PGN 格式。
 */
import { test, expect } from 'vitest'
import { serializeGame, validateImport } from './game-export.js'
import { START_FEN } from '../rules/position.js'
import type { GameMode } from '../types.js'

// ────────────────────────────────────────────────────────────
// 测试数据：初始局面两手合法着法
//   第1手 红：h2e2（炮二平五）
//   第2手 黑：h9g7（马8进7，elephantops rank 差异已在 Position 处理好）
// ────────────────────────────────────────────────────────────

const MOVE1 = 'h2e2'
const MOVE2 = 'h9g7'

// 预先用 Position 计算 fenAfter（测试中直接内联，避免引入 Position）
// 从 position.test.ts 可知 START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
// fenAfter 用真实值，取自 applyMove 链式调用——但测试不依赖这两个具体 FEN 字符串，
// 只验证 serializeGame 正确取 moves[*].move 字段和调用 describeMoveZh。
// 因此 fenAfter 可以用 START_FEN 做占位（serializeGame 使用 fenAfter 构造 prevFen for movesZh）。
// 用真实 FEN 确保 describeMoveZh 可正确描述。

// 用 Position 本身计算 fenAfter
import { Position } from '../rules/position.js'
const pos0 = Position.fromFen(START_FEN)
const fen1 = pos0.applyMove(MOVE1).fen()   // 红炮二平五后
const fen2 = pos0.applyMove(MOVE1).applyMove(MOVE2).fen()  // 黑马8进7后

const FAKE_GAME = {
  id: 42,
  startFen: START_FEN,
  mode: 'coach' as GameMode,
  humanSide: 'red' as const,
  result: 'red' as const,
  startedAt: '2026-06-20T00:00:00Z',
  endedAt: '2026-06-20T01:00:00Z',
}

const FAKE_MOVES = [
  { id: 1, gameId: 42, ply: 1, side: 'red' as const, move: MOVE1, fenAfter: fen1, scoreCp: 10, byAi: false },
  { id: 2, gameId: 42, ply: 2, side: 'black' as const, move: MOVE2, fenAfter: fen2, scoreCp: -5, byAi: true },
]

// ────────────────────────────────────────────────────────────
// ① serialize 一个两手对局 → moves/movesZh/result 正确
// ────────────────────────────────────────────────────────────
test('serializeGame: moves 字段正确取自 MoveRow.move', () => {
  const exported = serializeGame(FAKE_GAME, FAKE_MOVES)
  expect(exported.moves).toEqual([MOVE1, MOVE2])
})

test('serializeGame: movesZh 长度与 moves 相等，首手中文描述炮', () => {
  const exported = serializeGame(FAKE_GAME, FAKE_MOVES)
  expect(exported.movesZh).toHaveLength(2)
  // 炮二平五：第一手走炮
  expect(exported.movesZh[0]).toContain('炮')
  // 第二手走马
  expect(exported.movesZh[1]).toContain('马')
})

test('serializeGame: result/mode/startFen 正确', () => {
  const exported = serializeGame(FAKE_GAME, FAKE_MOVES)
  expect(exported.result).toBe('red')
  expect(exported.mode).toBe('coach')
  expect(exported.startFen).toBe(START_FEN)
  expect(exported.createdAt).toBe('2026-06-20T00:00:00Z')
})

test('serializeGame: movesZh try/catch — from-square 无棋子时留空串', () => {
  // e5e4：在初始局面（startFen = fen1 时 prevFen）的 e5 处没有棋子
  // describeMoveZh 会 throw "no piece at from-square"，应被 try/catch 捕获并留空串
  const movesWithBad = [
    { ...FAKE_MOVES[0] },
    { ...FAKE_MOVES[1], move: 'e5e4' }, // fen1 下 e5 为空格，describeMoveZh 会 throw
  ]
  const exported = serializeGame(FAKE_GAME, movesWithBad)
  // 第一手仍正常
  expect(exported.movesZh[0]).toContain('炮')
  // 第二手容错为空串
  expect(exported.movesZh[1]).toBe('')
})

// ────────────────────────────────────────────────────────────
// ② validateImport 合法 moves 通过、返回规整
// ────────────────────────────────────────────────────────────
test('validateImport: 合法两手 → 返回规整对象', () => {
  const result = validateImport({
    startFen: START_FEN,
    moves: [MOVE1, MOVE2],
    mode: 'coach',
    result: 'red',
  })
  expect(result.startFen).toBe(START_FEN)
  expect(result.moves).toEqual([MOVE1, MOVE2])
  expect(result.mode).toBe('coach')
  expect(result.result).toBe('red')
})

// ────────────────────────────────────────────────────────────
// ③ validateImport 非法着法 throw（含手数信息）
// ────────────────────────────────────────────────────────────
test('validateImport: 非法着法 throw，含手数', () => {
  expect(() => validateImport({
    startFen: START_FEN,
    moves: [MOVE1, 'a0a0'],   // 第2手非法
    mode: 'coach',
  })).toThrow(/2/)  // 错误信息含"第 2 手"之类数字
})

test('validateImport: 完全不存在的 UCI 格式 throw', () => {
  expect(() => validateImport({
    moves: ['zzz'],
  })).toThrow()
})

// ────────────────────────────────────────────────────────────
// ④ 缺省 startFen/mode 填默认值
// ────────────────────────────────────────────────────────────
test('validateImport: startFen 缺省用 START_FEN', () => {
  const result = validateImport({ moves: [MOVE1] })
  expect(result.startFen).toBe(START_FEN)
})

test('validateImport: mode 缺省 coach', () => {
  const result = validateImport({ moves: [MOVE1] })
  expect(result.mode).toBe('coach')
})

test('validateImport: result 缺省 null', () => {
  const result = validateImport({ moves: [MOVE1] })
  expect(result.result).toBeNull()
})

test('validateImport: result 非法值 throw', () => {
  expect(() => validateImport({
    moves: [MOVE1],
    result: 'unknown',
  })).toThrow(/result/)
})

test('validateImport: 空 moves 合法（零手对局）', () => {
  const result = validateImport({ moves: [] })
  expect(result.moves).toEqual([])
})
