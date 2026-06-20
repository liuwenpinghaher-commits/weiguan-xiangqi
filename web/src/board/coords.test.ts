/**
 * 棋盘坐标往返测试
 *
 * 验证 squareToPikafish 与 pikafishToSquare 互为逆操作，
 * 并确认已知格子的转换符合 Board.tsx 头注的朝向假设：
 *   - 库 Square row 1 = 红方底线 → Pikafish row 0
 *   - 库 Square row 10 = 黑方底线 → Pikafish row 9
 *
 * 若转换逻辑与真实引擎/库朝向不符，此测试会同步失败（防漂移）。
 */

import { describe, it, expect } from 'vitest'
import { squareToPikafish, pikafishToSquare } from './Board.js'

// 象棋棋盘：列 a-i，库 Square 行 1-10
const COLS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i']
const ROWS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('squareToPikafish', () => {
  it('红方底线 e1 → e0（炮的初始列参考）', () => {
    expect(squareToPikafish('e1')).toBe('e0')
  })

  it('黑方底线 e10 → e9', () => {
    expect(squareToPikafish('e10')).toBe('e9')
  })

  it('红方炮初始位 h1 → h0', () => {
    // 红炮（炮二）初始在 b3 / h3（Pikafish 记法），库中对应 h1
    // 注：实际初始局炮在 h3(Pikafish)=h4(Square)，这里只测边界行
    expect(squareToPikafish('h1')).toBe('h0')
  })

  it('最左上角 a10 → a9', () => {
    expect(squareToPikafish('a10')).toBe('a9')
  })

  it('最右下角 i1 → i0', () => {
    expect(squareToPikafish('i1')).toBe('i0')
  })
})

describe('pikafishToSquare', () => {
  it('e0 → e1（红方底线）', () => {
    expect(pikafishToSquare('e0')).toBe('e1')
  })

  it('e9 → e10（黑方底线）', () => {
    expect(pikafishToSquare('e9')).toBe('e10')
  })

  it('h0 → h1', () => {
    expect(pikafishToSquare('h0')).toBe('h1')
  })

  it('a9 → a10', () => {
    expect(pikafishToSquare('a9')).toBe('a10')
  })
})

describe('坐标往返一致性（square → pikafish → square）', () => {
  it('所有格子往返后与原值相等', () => {
    const mismatches: string[] = []
    for (const col of COLS) {
      for (const row of ROWS) {
        const sq = `${col}${row}`
        const pika = squareToPikafish(sq)
        const back = pikafishToSquare(pika)
        if (back !== sq) {
          mismatches.push(`${sq} → ${pika} → ${back}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('坐标往返一致性（pikafish → square → pikafish）', () => {
  it('所有 Pikafish 格子往返后与原值相等', () => {
    const mismatches: string[] = []
    for (const col of COLS) {
      for (let r = 0; r <= 9; r++) {
        const pika = `${col}${r}`
        const sq = pikafishToSquare(pika)
        const back = squareToPikafish(sq)
        if (back !== pika) {
          mismatches.push(`${pika} → ${sq} → ${back}`)
        }
      }
    }
    expect(mismatches).toEqual([])
  })
})

describe('着法字符串解析（lastMove 场景）', () => {
  it('"h2e2" 正确拆分为 from=h2(Square h3) to=e2(Square e3)', () => {
    // Pikafish 着法 "h2e2" 表示从 h2→e2
    const fromPika = 'h2'
    const toPika = 'e2'
    expect(pikafishToSquare(fromPika)).toBe('h3')
    expect(pikafishToSquare(toPika)).toBe('e3')
  })

  it('"e0e1" 红将从底线上移一格', () => {
    expect(pikafishToSquare('e0')).toBe('e1')
    expect(pikafishToSquare('e1')).toBe('e2')
  })
})
