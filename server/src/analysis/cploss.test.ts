import { test, expect } from 'vitest'
import { cpLoss } from './cploss.js'

test('完美着:走完对手视角=自己原优势取反 → 丢分 0', () => {
  expect(cpLoss(50, -50)).toBe(0)
})
test('小缓手:略有让步', () => {
  expect(cpLoss(50, 30)).toBe(80)
})
test('好棋保持优势:负 loss 截断为 0', () => {
  expect(cpLoss(300, -280)).toBe(20)
  expect(cpLoss(50, -120)).toBe(0)
})
test('大漏着', () => {
  expect(cpLoss(50, 400)).toBe(450)
})
test('mate 极值也可计算(错失杀棋丢分很大)', () => {
  expect(cpLoss(29997, 200)).toBe(30197)
})
