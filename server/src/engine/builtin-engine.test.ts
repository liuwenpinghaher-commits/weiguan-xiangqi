import { describe, it, expect } from 'vitest'
import { BuiltinEngine, evaluateFenRedCp } from './builtin-engine.js'
import { START_FEN, Position } from '../rules/position.js'
import { buildServer } from '../ws-server.js'

describe('BuiltinEngine (内置确定性 UCI 兼容象棋引擎)', () => {
  it('初始局面 evaluateFenRedCp 红黑对称得分为 0', () => {
    expect(evaluateFenRedCp(START_FEN)).toBe(0)
  })

  it('analyze 返回请求的 multipv 条合法候选着法且按评分降序排列', async () => {
    const engine = new BuiltinEngine()
    expect(engine.status()).toEqual({ configured: true, degraded: false, reason: null })

    const lines = await engine.analyze(START_FEN, { multipv: 5, movetime: 100 })
    expect(lines).toHaveLength(5)
    const legal = new Set(Position.fromFen(START_FEN).legalMoves())
    for (let i = 0; i < lines.length; i++) {
      expect(lines[i].multipv).toBe(i + 1)
      expect(legal.has(lines[i].move)).toBe(true)
      expect(lines[i].pv[0]).toBe(lines[i].move)
      if (i > 0) {
        expect(lines[i - 1].scoreCp).toBeGreaterThanOrEqual(lines[i].scoreCp)
      }
    }
  })

  it('未配置外部 PIKAFISH_PATH 时 buildServer 自动启用 BuiltinEngine 支持完整对弈与诊断', async () => {
    const app = await buildServer({ dbPath: ':memory:' })
    try {
      const statusRes = await app.inject({ method: 'GET', url: '/engine/status' })
      expect(statusRes.statusCode).toBe(200)
      expect(statusRes.json()).toEqual({ configured: true, degraded: false, reason: null })

      const importRes = await app.inject({
        method: 'POST',
        url: '/games/import',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ moves: ['h2e2', 'b9c7'] }),
      })
      expect(importRes.statusCode).toBe(200)
      const { gameId } = importRes.json<{ gameId: number }>()

      const diagRes = await app.inject({ method: 'POST', url: `/games/${gameId}/diagnose` })
      expect(diagRes.statusCode).toBe(200)
      const diagBody = diagRes.json<{ annotated: number; estElo: number; diagnosisStatus: { status: string } }>()
      expect(diagBody.annotated).toBe(2)
      expect(typeof diagBody.estElo).toBe('number')
      expect(diagBody.diagnosisStatus.status).toBe('ok')
    } finally {
      await app.close()
    }
  })
})
