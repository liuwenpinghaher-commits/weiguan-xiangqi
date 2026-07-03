import { describe, it, expect } from 'vitest'
import { Position, START_FEN } from './position.js'
import { describeMoveZh } from './describe-move.js'

/**
 * 双 FEN 解析器一致性契约:Position(elephantops)与 describe-move(自带 parseBoard)
 * 是两套独立解析,坐标/记法约定必须保持一致(历史坑 OPEN-ISSUES #1)。
 * 本测试作为漂移护栏:START_FEN 下每个合法着法,describeMoveZh 必须能产出非空中文描述。
 */
describe('FEN 双解析器一致性护栏', () => {
  it('START_FEN 全部合法着法 describeMoveZh 不抛且非空', () => {
    const pos = Position.fromFen(START_FEN)
    const moves = pos.legalMoves()
    expect(moves.length).toBeGreaterThan(0)
    for (const m of moves) {
      const zh = describeMoveZh(START_FEN, m)
      expect(zh, `move ${m}`).toBeTruthy()
    }
  })

  it('炮二平五坐标记法约定不漂移', () => {
    expect(describeMoveZh(START_FEN, 'h2e2')).toBe('红炮二平五')
  })

  it('走两个来回后的中局 FEN,两解析器仍一致可用', () => {
    let pos = Position.fromFen(START_FEN)
    for (const m of ['h2e2', 'h9g7', 'h0g2', 'i9h9']) {
      const fen = pos.fen()
      expect(describeMoveZh(fen, m)).toBeTruthy()
      pos = pos.applyMove(m)
    }
  })
})
