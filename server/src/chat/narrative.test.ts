import { describe, it, expect } from 'vitest'
import { buildNarrative } from './narrative.js'

describe('buildNarrative', () => {
  it('无有效评分 → 空串', () => {
    expect(buildNarrative([])).toBe('')
    expect(buildNarrative([{ ply: 1, scoreCp: null, side: 'red' }])).toBe('')
  })
  it('给出当前走势(红优/黑优/均势)', () => {
    const s = buildNarrative([{ ply: 2, scoreCp: 30, side: 'red' }, { ply: 4, scoreCp: 260, side: 'red' }])
    expect(s).toContain('红')
    expect(s).toContain('第4手')
  })
  it('识别最大转折点(相邻评分跳变最大处)', () => {
    const s = buildNarrative([
      { ply: 2, scoreCp: 10, side: 'red' }, { ply: 4, scoreCp: 20, side: 'red' }, { ply: 6, scoreCp: -240, side: 'red' },
    ])
    expect(s).toContain('第6手')
    expect(s).toContain('转折')
  })

  // ── C1 回归护栏 ──────────────────────────────────────────────────────────
  // repo.getMoves 返回的 scoreCp 是"走子方视角"厘兵分(见 types.ts 对 EngineLine.scoreCp 的注释,
  // 以及 game-session.ts addMove 直接写入 decision.chosenLine.scoreCp,未做红方转换)。
  // AI 默认执黑时,若不按 side 转换直接当红方视角判断,谁占优的结论会整体反过来。
  it('side=black 时须按红方视角换算:黑方视角下的+300(黑大优)→ 应判"黑方占优",不能判成"红方占优"', () => {
    const s = buildNarrative([{ ply: 4, scoreCp: 300, side: 'black' }])
    expect(s).toContain('黑方占优')
    expect(s).not.toContain('红方占优')
  })
  it('side=red 时原样使用(无需取反):红方视角下的+300 → 判"红方占优"', () => {
    const s = buildNarrative([{ ply: 4, scoreCp: 300, side: 'red' }])
    expect(s).toContain('红方占优')
    expect(s).not.toContain('黑方占优')
  })
})
