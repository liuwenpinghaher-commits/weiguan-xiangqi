import { test, expect, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { GamesRepo } from '../store/games-repo.js'
import { AnalysisRepo } from '../store/analysis-repo.js'
import { diagnoseGame } from './diagnose-game.js'
import type { EngineLine } from '../types.js'

const F = 'RRNNCCrrnnccKk' // 棋盘段:车马炮各双方 2 个 → majors=12(K/k 不计)
const line = (move: string, cp: number, mate: number | null = null): EngineLine[] =>
  [{ multipv: 1, move, scoreCp: cp, mate, pv: [move] }]

test('标注双方每手并聚合人方成长指标', async () => {
  const db = openDb(':memory:')
  const games = new GamesRepo(db)
  const analysis = new AnalysisRepo(db)
  const gameId = games.createGame({ mode: 'coach', humanSide: 'red', startFen: `${F}/s0 w`, startedAt: 't' })
  games.addMove({ gameId, side: 'red', move: 'm1', fenAfter: `${F}/s1 b`, scoreCp: null, byAi: false })
  games.addMove({ gameId, side: 'black', move: 'm2', fenAfter: `${F}/s2 w`, scoreCp: 30, byAi: true })
  games.addMove({ gameId, side: 'red', move: 'm3', fenAfter: `${F}/s3 b`, scoreCp: null, byAi: false })
  games.finishGame(gameId, 'black', 't2')

  const evals: Record<string, EngineLine[]> = {
    [`${F}/s0 w`]: line('b0c2', 50),
    [`${F}/s1 b`]: line('x', -30),
    [`${F}/s2 w`]: line('y', 40),
    [`${F}/s3 b`]: line('z', 300),
  }
  const engine = { analyze: vi.fn(async (fen: string) => evals[fen]) }

  const sum = await diagnoseGame({ games, analysis, engine, clock: () => 'tA' }, gameId)

  const ann = analysis.getAnnotations(gameId)
  expect(ann.map((a) => a.ply)).toEqual([1, 2, 3])
  expect(ann[0]).toMatchObject({ ply: 1, side: 'red', cpLoss: 20, bestMove: 'b0c2', theme: 'ok' })
  expect(ann[2]).toMatchObject({ ply: 3, side: 'red', cpLoss: 340, theme: 'blunder' })

  expect(sum).toMatchObject({ annotated: 3, humanSide: 'red', acpl: 180, blunders: 1, mistakes: 0 })
  const g = analysis.getGrowthMetric(gameId)!
  expect(g.acpl).toBe(180)
  expect(g.estElo).toBe(1520)
  expect(g.openingAcpl).toBe(180)
  expect(g.result).toBe('black')
  db.close()
})

test('无着法的局抛错', async () => {
  const db = openDb(':memory:')
  const games = new GamesRepo(db)
  const analysis = new AnalysisRepo(db)
  const gameId = games.createGame({ mode: 'coach', humanSide: 'red', startFen: 'x', startedAt: 't' })
  const engine = { analyze: vi.fn() }
  await expect(diagnoseGame({ games, analysis, engine, clock: () => 't' }, gameId)).rejects.toThrow(/no moves/)
})
