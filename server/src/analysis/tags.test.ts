import { test, expect } from 'vitest'
import { classifyTheme, type ThemeSignals } from './tags.js'

const base: ThemeSignals = { cpLoss: 0, hadMateBefore: false, tookMate: false, lostMaterial: false }

test('丢分很小 → ok', () => { expect(classifyTheme({ ...base, cpLoss: 30 })).toBe('ok') })
test('中等丢分 → 缓手', () => { expect(classifyTheme({ ...base, cpLoss: 80 })).toBe('inaccuracy') })
test('较大丢分 → 错误', () => { expect(classifyTheme({ ...base, cpLoss: 200 })).toBe('mistake') })
test('巨大丢分 → 漏着', () => { expect(classifyTheme({ ...base, cpLoss: 400 })).toBe('blunder') })
test('本有杀却没抓住 → 错失杀棋(优先)', () => {
  expect(classifyTheme({ ...base, cpLoss: 500, hadMateBefore: true, tookMate: false })).toBe('missed_mate')
})
test('本有杀且抓住了 → 按丢分(通常 ok)', () => {
  expect(classifyTheme({ ...base, cpLoss: 0, hadMateBefore: true, tookMate: true })).toBe('ok')
})
test('丢子且较大丢分 → hangs_piece', () => {
  expect(classifyTheme({ ...base, cpLoss: 250, lostMaterial: true })).toBe('hangs_piece')
})
test('子力减少但丢分不大(有补偿)→ 不算丢子', () => {
  expect(classifyTheme({ ...base, cpLoss: 80, lostMaterial: true })).toBe('inaccuracy')
})
