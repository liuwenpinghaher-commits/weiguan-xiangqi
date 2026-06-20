import { test, expect } from 'vitest'
import { openDb } from './db.js'
import { GamesRepo } from './games-repo.js'

function repo() { return new GamesRepo(openDb(':memory:')) }

test('createGame 返回自增 id,getGame 能取回', () => {
  const r = repo()
  const id = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'FEN', startedAt: '2026-06-19T00:00:00Z' })
  expect(id).toBeGreaterThan(0)
  const g = r.getGame(id)!
  expect(g.mode).toBe('coach')
  expect(g.result).toBeNull()
})

test('addMove 递增 ply 并可按局取回有序着法', () => {
  const r = repo()
  const id = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'FEN', startedAt: 't' })
  r.addMove({ gameId: id, side: 'red', move: 'h2e2', fenAfter: 'F1', scoreCp: 20, byAi: false })
  r.addMove({ gameId: id, side: 'black', move: 'b9c7', fenAfter: 'F2', scoreCp: -15, byAi: true })
  const moves = r.getMoves(id)
  expect(moves.map(m => m.ply)).toEqual([1, 2])
  expect(moves[1].byAi).toBe(true)
  expect(moves[0].move).toBe('h2e2')
})

test('finishGame 写入结果与结束时间', () => {
  const r = repo()
  const id = r.createGame({ mode: 'humanlike', humanSide: 'black', startFen: 'FEN', startedAt: 't' })
  r.finishGame(id, 'red', '2026-06-19T01:00:00Z')
  const g = r.getGame(id)!
  expect(g.result).toBe('red')
  expect(g.endedAt).toBe('2026-06-19T01:00:00Z')
})

test('recentResults 按时间降序返回映射后的胜负平,人方 red', () => {
  const r = repo()
  // 创建三局并结束:红胜、黑胜、平局(按时间先后)
  const id1 = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'F', startedAt: '2026-06-19T01:00:00Z' })
  r.finishGame(id1, 'red', '2026-06-19T01:10:00Z')   // red 赢 → 'win'

  const id2 = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'F', startedAt: '2026-06-19T02:00:00Z' })
  r.finishGame(id2, 'black', '2026-06-19T02:10:00Z') // black 赢 → 'loss'

  const id3 = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'F', startedAt: '2026-06-19T03:00:00Z' })
  r.finishGame(id3, 'draw', '2026-06-19T03:10:00Z')  // 平 → 'draw'

  // 最近在前:ended_at DESC → id3, id2, id1
  const results = r.recentResults('red', 10)
  expect(results).toEqual(['draw', 'loss', 'win'])
})

test('recentResults limit 限制返回数量', () => {
  const r = repo()
  for (let i = 0; i < 5; i++) {
    const id = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'F',
      startedAt: `2026-06-19T0${i}:00:00Z` })
    r.finishGame(id, 'red', `2026-06-19T0${i}:10:00Z`)
  }
  expect(r.recentResults('red', 3)).toHaveLength(3)
})

test('recentResults 空库返回空数组', () => {
  const r = repo()
  expect(r.recentResults('red', 10)).toEqual([])
})

test('recentResults 只返回已结束局(result NOT NULL)', () => {
  const r = repo()
  // 一局已结束、一局未结束
  const id1 = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'F', startedAt: '2026-06-19T01:00:00Z' })
  r.finishGame(id1, 'red', '2026-06-19T01:10:00Z')
  r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'F', startedAt: '2026-06-19T02:00:00Z' }) // 未结束
  const results = r.recentResults('red', 10)
  expect(results).toHaveLength(1)
  expect(results[0]).toBe('win')
})
