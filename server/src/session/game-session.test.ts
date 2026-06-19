import { test, expect, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { GamesRepo } from '../store/games-repo.js'
import { GameSession } from './game-session.js'
import type { EngineLine } from '../types.js'

// Fake 规则:着法即字符串,走两手就结束(便于测编排)
function fakePosition(fen: string) {
  return {
    fen: () => fen,
    sideToMove: () => (fen.includes(' w ') ? 'red' : 'black') as 'red' | 'black',
    legalMoves: () => ['h2e2', 'b0c2'],
    applyMove: (m: string) => fakePosition(fen.includes(' w ') ? fen.replace(' w ', ' b ') : fen.replace(' b ', ' w ')),
    isGameOver: () => ({ over: false as const }),
  }
}
const fakeEngine = { analyze: vi.fn(async (): Promise<EngineLine[]> => [
  { multipv: 1, move: 'b0c2', scoreCp: 20, mate: null, pv: ['b0c2'] },
]) }

test('playHumanMove 落人着并触发 AI 回着,均入库且 ply 连续', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  let t = 0
  const session = new GameSession({
    repo, engine: fakeEngine as any,
    makePosition: fakePosition as any,
    clock: () => `t${t++}`,
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })

  const res = await session.playHumanMove(gameId, 'h2e2')
  expect(res.aiMove).toBe('b0c2')
  const moves = repo.getMoves(gameId)
  expect(moves.map(m => m.ply)).toEqual([1, 2])
  expect(moves[0].byAi).toBe(false)
  expect(moves[1].byAi).toBe(true)
})

test('非法人着被拒,不入库', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const session = new GameSession({ repo, engine: fakeEngine as any, makePosition: fakePosition as any, clock: () => 't' })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await expect(session.playHumanMove(gameId, 'z9z9')).rejects.toThrow()
  expect(repo.getMoves(gameId)).toHaveLength(0)
})

test('AI 回着失败时原子回滚:人着不入库、状态不变,重试可成功', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const flaky = { analyze: vi.fn() }
  const session = new GameSession({
    repo, engine: flaky as any, makePosition: fakePosition as any, clock: () => 't',
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })

  // 第一次 AI analyze 抛错
  flaky.analyze.mockRejectedValueOnce(new Error('engine analyze timeout'))
  await expect(session.playHumanMove(gameId, 'h2e2')).rejects.toThrow()
  // 人着与 AI 着都未入库
  expect(repo.getMoves(gameId)).toHaveLength(0)

  // 重试:这次 analyze 成功,人着+AI着都入库
  flaky.analyze.mockResolvedValueOnce([
    { multipv: 1, move: 'b0c2', scoreCp: 20, mate: null, pv: ['b0c2'] },
  ])
  const res = await session.playHumanMove(gameId, 'h2e2')
  expect(res.aiMove).toBe('b0c2')
  const moves = repo.getMoves(gameId)
  expect(moves.map(m => m.ply)).toEqual([1, 2])
  expect(moves[0].byAi).toBe(false)
  expect(moves[1].byAi).toBe(true)
})

test('轮次守卫:不是 human 一方时拒绝,不入库不改状态', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const session = new GameSession({ repo, engine: fakeEngine as any, makePosition: fakePosition as any, clock: () => 't' })
  // human=red,但起始局面轮到 black 走(fen 含 ' b ')
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START b - - 0 1' })
  await expect(session.playHumanMove(gameId, 'h2e2')).rejects.toThrow(/not your turn/i)
  expect(repo.getMoves(gameId)).toHaveLength(0)
})
