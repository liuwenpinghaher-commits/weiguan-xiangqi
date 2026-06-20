import { test, expect } from 'vitest'
import { openDb } from './db.js'
import { GamesRepo } from './games-repo.js'
import { TrainingRepo } from './training-repo.js'

function setup() {
  const db = openDb(':memory:')
  const gamesRepo = new GamesRepo(db)
  const gameId1 = gamesRepo.createGame({ mode: 'coach', humanSide: 'red', startFen: 'FEN', startedAt: 't1' })
  const gameId2 = gamesRepo.createGame({ mode: 'coach', humanSide: 'black', startFen: 'FEN', startedAt: 't2' })
  return { repo: new TrainingRepo(db), gameId1, gameId2 }
}

test('插入一条作答记录并返回 id', () => {
  const { repo, gameId1 } = setup()
  const id = repo.addDrillAttempt({
    gameId: gameId1,
    ply: 3,
    chosenMove: 'h2e2',
    correct: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  })
  expect(typeof id).toBe('number')
  expect(id).toBeGreaterThan(0)
})

test('drillStats 正确统计单局的 total 和 correct', () => {
  const { repo, gameId1 } = setup()
  repo.addDrillAttempt({ gameId: gameId1, ply: 1, chosenMove: 'a1a2', correct: true,  createdAt: 'T1' })
  repo.addDrillAttempt({ gameId: gameId1, ply: 3, chosenMove: 'b1b2', correct: false, createdAt: 'T2' })
  repo.addDrillAttempt({ gameId: gameId1, ply: 5, chosenMove: 'c1c2', correct: true,  createdAt: 'T3' })
  const stats = repo.drillStats(gameId1)
  expect(stats.total).toBe(3)
  expect(stats.correct).toBe(2)
})

test('drillStats 对未做过题的局返回零值', () => {
  const { repo, gameId1 } = setup()
  const stats = repo.drillStats(gameId1)
  expect(stats.total).toBe(0)
  expect(stats.correct).toBe(0)
})

test('drillStats 只统计指定 gameId 不跨局', () => {
  const { repo, gameId1, gameId2 } = setup()
  repo.addDrillAttempt({ gameId: gameId1, ply: 1, chosenMove: 'a1a2', correct: true,  createdAt: 'T1' })
  repo.addDrillAttempt({ gameId: gameId2, ply: 2, chosenMove: 'b1b2', correct: true,  createdAt: 'T2' })
  repo.addDrillAttempt({ gameId: gameId2, ply: 4, chosenMove: 'c1c2', correct: false, createdAt: 'T3' })
  expect(repo.drillStats(gameId1)).toEqual({ total: 1, correct: 1 })
  expect(repo.drillStats(gameId2)).toEqual({ total: 2, correct: 1 })
})

test('drillStatsAll 汇总所有局的全局进度', () => {
  const { repo, gameId1, gameId2 } = setup()
  repo.addDrillAttempt({ gameId: gameId1, ply: 1, chosenMove: 'a1a2', correct: true,  createdAt: 'T1' })
  repo.addDrillAttempt({ gameId: gameId1, ply: 3, chosenMove: 'b1b2', correct: false, createdAt: 'T2' })
  repo.addDrillAttempt({ gameId: gameId2, ply: 2, chosenMove: 'c1c2', correct: true,  createdAt: 'T3' })
  const all = repo.drillStatsAll()
  expect(all.total).toBe(3)
  expect(all.correct).toBe(2)
})

test('drillStatsAll 无记录时返回零值', () => {
  const { repo } = setup()
  expect(repo.drillStatsAll()).toEqual({ total: 0, correct: 0 })
})
