/**
 * TDD: classifyMoveKind 各阈值边界测试
 * 先红后绿 — 先跑此文件确认红，再补实现。
 */
import { test, expect } from 'vitest'
import { classifyMoveKind } from './stimulus-kind.js'

// ─── blunder 阈值 ─────────────────────────────────────────────────────────────

test('swing <= -150 → blunder', () => {
  expect(classifyMoveKind(-150, false, 0)).toBe('blunder')
})

test('swing = -151 → blunder', () => {
  expect(classifyMoveKind(-151, false, 0)).toBe('blunder')
})

test('swing = -149 → 非 blunder(应为 move)', () => {
  expect(classifyMoveKind(-149, false, 0)).not.toBe('blunder')
})

// ─── brilliant 阈值 ───────────────────────────────────────────────────────────

test('swing >= 150 → brilliant', () => {
  expect(classifyMoveKind(150, false, 0)).toBe('brilliant')
})

test('swing = 200 → brilliant', () => {
  expect(classifyMoveKind(200, false, 0)).toBe('brilliant')
})

test('swing = 149 → 非 brilliant', () => {
  expect(classifyMoveKind(149, false, 0)).not.toBe('brilliant')
})

// ─── long_think ───────────────────────────────────────────────────────────────

test('lastMoveMs > 8000 且非 blunder/brilliant → long_think', () => {
  expect(classifyMoveKind(0, false, 8001)).toBe('long_think')
})

test('lastMoveMs = 8000 → 不触发 long_think(严格大于)', () => {
  expect(classifyMoveKind(0, false, 8000)).not.toBe('long_think')
})

test('blunder 优先于 long_think: swing=-200, lastMoveMs=9000 → blunder', () => {
  expect(classifyMoveKind(-200, false, 9000)).toBe('blunder')
})

test('brilliant 优先于 long_think: swing=200, lastMoveMs=9000 → brilliant', () => {
  expect(classifyMoveKind(200, false, 9000)).toBe('brilliant')
})

// ─── 普通着法 ─────────────────────────────────────────────────────────────────

test('普通非吃子 → move', () => {
  expect(classifyMoveKind(10, false, 0)).toBe('move')
})

test('吃子但非 blunder/brilliant → move(当前无专属 tension 提升种类,kind 仍 move)', () => {
  // 吃子时 tension 会在调用方提升,kind 本身返回 move
  expect(classifyMoveKind(50, true, 0)).toBe('move')
})

// ─── 边界：刚好零 ─────────────────────────────────────────────────────────────

test('swing=0 → move', () => {
  expect(classifyMoveKind(0, false, 0)).toBe('move')
})
