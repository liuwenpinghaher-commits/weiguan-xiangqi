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
