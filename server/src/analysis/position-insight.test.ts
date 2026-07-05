import { describe, it, expect } from 'vitest'
import { buildPositionInsight } from './position-insight.js'
import type { EngineLine } from '../types.js'

// 红方起始局面(红先走)
const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

function fakeEngine(lines: EngineLine[]) {
  return { analyze: async () => lines }
}

describe('buildPositionInsight', () => {
  it('红方走子:evalCp 直接取 scoreCp(红方视角),bestMoveZh 由 pv[0] 推出', async () => {
    const eng = fakeEngine([{ multipv: 1, move: 'h2e2', scoreCp: 60, mate: null, pv: ['h2e2', 'h9g7'] }])
    const ins = await buildPositionInsight(eng, START, 300)
    expect(ins).not.toBeNull()
    expect(ins!.evalCp).toBe(60)                 // 红走子 → 不翻转
    expect(ins!.bestMoveZh).toBe('红炮二平五')    // h2e2 从起始局面
    expect(ins!.pvZh.length).toBeGreaterThanOrEqual(1)
    expect(ins!.pvZh[0]).toBe('红炮二平五')
  })

  it('黑方走子:evalCp 翻转为红方视角', async () => {
    const blackToMove = START.replace(' w ', ' b ')
    const eng = fakeEngine([{ multipv: 1, move: 'h9g7', scoreCp: 100, mate: null, pv: ['h9g7'] }])
    const ins = await buildPositionInsight(eng, blackToMove, 300)
    expect(ins!.evalCp).toBe(-100)
  })

  it('黑方走子且可杀:mate 翻转为红方视角(负=黑方杀)', async () => {
    const blackToMove = START.replace(' w ', ' b ')
    const eng = fakeEngine([{ multipv: 1, move: 'h9g7', scoreCp: 30000, mate: 3, pv: ['h9g7'] }])
    const ins = await buildPositionInsight(eng, blackToMove, 300)
    expect(ins!.mate).toBe(-3)   // 黑方 3 步杀 → 红方视角记 -3
  })

  it('红方走子且可杀:mate 不翻转(正=红方杀)', async () => {
    const eng = fakeEngine([{ multipv: 1, move: 'h2e2', scoreCp: 30000, mate: 2, pv: ['h2e2'] }])
    const ins = await buildPositionInsight(eng, START, 300)
    expect(ins!.mate).toBe(2)
  })

  it('引擎抛错 → 返回 null(降级)', async () => {
    const eng = { analyze: async () => { throw new Error('引擎未配置') } }
    expect(await buildPositionInsight(eng, START, 300)).toBeNull()
  })

  it('非法 fen → 返回 null(不抛)', async () => {
    const eng = fakeEngine([{ multipv: 1, move: 'h2e2', scoreCp: 60, mate: null, pv: ['h2e2'] }])
    expect(await buildPositionInsight(eng, 'not-a-valid-fen', 300)).toBeNull()
  })

  it('引擎返回空数组 → 返回 null', async () => {
    expect(await buildPositionInsight(fakeEngine([]), START, 300)).toBeNull()
  })
})
