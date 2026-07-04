import { describe, it, expect } from 'vitest'
import { buildNarrative } from './narrative.js'

describe('buildNarrative', () => {
  it('无有效评分 → 空串', () => {
    expect(buildNarrative([])).toBe('')
    expect(buildNarrative([{ ply: 1, scoreCp: null }])).toBe('')
  })
  it('给出当前走势(红优/黑优/均势)', () => {
    const s = buildNarrative([{ ply: 2, scoreCp: 30 }, { ply: 4, scoreCp: 260 }])
    expect(s).toContain('红')
    expect(s).toContain('第4手')
  })
  it('识别最大转折点(相邻评分跳变最大处)', () => {
    const s = buildNarrative([
      { ply: 2, scoreCp: 10 }, { ply: 4, scoreCp: 20 }, { ply: 6, scoreCp: -240 },
    ])
    expect(s).toContain('第6手')
    expect(s).toContain('转折')
  })
})
