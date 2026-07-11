import { test, expect } from 'vitest'
import { openDb } from './db.js'
import { GamesRepo } from './games-repo.js'
import { AnalysisRepo } from './analysis-repo.js'

function setup() {
  const db = openDb(':memory:')
  const gameId = new GamesRepo(db).createGame({ mode: 'coach', humanSide: 'red', startFen: 'FEN', startedAt: 't' })
  return { repo: new AnalysisRepo(db), games: new GamesRepo(db), gameId }
}

test('保存与按 ply 有序读取标注', () => {
  const { repo, gameId } = setup()
  repo.saveAnnotation({ gameId, ply: 1, side: 'red', cpLoss: 80, bestMove: 'h2e2', phase: 'opening', theme: 'inaccuracy' })
  repo.saveAnnotation({ gameId, ply: 3, side: 'red', cpLoss: 0, bestMove: 'b2e2', phase: 'opening', theme: 'ok' })
  expect(repo.getAnnotations(gameId).map((a) => a.ply)).toEqual([1, 3])
})

test('重复 (game, ply) 覆盖而非新增', () => {
  const { repo, gameId } = setup()
  repo.saveAnnotation({ gameId, ply: 1, side: 'red', cpLoss: 80, bestMove: 'h2e2', phase: 'opening', theme: 'inaccuracy' })
  repo.saveAnnotation({ gameId, ply: 1, side: 'red', cpLoss: 300, bestMove: 'h2e2', phase: 'opening', theme: 'blunder' })
  const ann = repo.getAnnotations(gameId)
  expect(ann).toHaveLength(1)
  expect(ann[0].theme).toBe('blunder')
})

test('保存/读取成长指标 + 列表', () => {
  const { repo, gameId } = setup()
  repo.saveGrowthMetric({
    gameId, analyzedAt: 't1', humanSide: 'red', acpl: 90, accuracy: 74, estElo: 2060,
    openingAcpl: 40, midgameAcpl: 120, endgameAcpl: 80, blunders: 1, mistakes: 2, result: 'black',
  })
  expect(repo.getGrowthMetric(gameId)!.acpl).toBe(90)
  expect(repo.listGrowthMetrics()).toHaveLength(1)
})

test('弱点画像:按 phase×theme 计数,排除 ok,只统计指定执方的人类着法', () => {
  const { repo, games, gameId } = setup()
  const blackHumanGame = games.createGame({ mode: 'coach', humanSide: 'black', startFen: 'FEN', startedAt: 't2' })
  repo.saveAnnotation({ gameId, ply: 1, side: 'red', cpLoss: 0, bestMove: 'a', phase: 'opening', theme: 'ok' })
  repo.saveAnnotation({ gameId, ply: 3, side: 'red', cpLoss: 200, bestMove: 'a', phase: 'midgame', theme: 'mistake' })
  repo.saveAnnotation({ gameId, ply: 5, side: 'red', cpLoss: 250, bestMove: 'a', phase: 'midgame', theme: 'mistake' })
  repo.saveAnnotation({ gameId, ply: 2, side: 'black', cpLoss: 400, bestMove: 'a', phase: 'midgame', theme: 'blunder' })
  // 这条是执黑局里的 AI 红方失误,不应混入“我执红”的弱点画像。
  repo.saveAnnotation({ gameId: blackHumanGame, ply: 1, side: 'red', cpLoss: 999, bestMove: 'a', phase: 'opening', theme: 'blunder' })
  // 这条才是执黑用户自己的弱点。
  repo.saveAnnotation({ gameId: blackHumanGame, ply: 2, side: 'black', cpLoss: 300, bestMove: 'a', phase: 'endgame', theme: 'mistake' })
  expect(repo.weaknessProfile('red')).toEqual([{ phase: 'midgame', theme: 'mistake', count: 2, avgLoss: 225 }])
  expect(repo.weaknessProfile('black')).toEqual([{ phase: 'endgame', theme: 'mistake', count: 1, avgLoss: 300 }])
})
