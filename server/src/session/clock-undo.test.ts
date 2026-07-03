import { test, expect, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { GamesRepo } from '../store/games-repo.js'
import { GameSession } from './game-session.js'
import { RuntimeConfig } from '../config/runtime-config.js'
import { SettingsRepo } from '../store/settings-repo.js'
import type { EngineLine } from '../types.js'

function makeCfg() {
  return new RuntimeConfig(new SettingsRepo(openDb(':memory:')), () => '2026-07-03T00:00:00.000Z')
}
function fakePosition(fen: string) {
  return {
    fen: () => fen,
    sideToMove: () => (fen.includes(' w ') ? 'red' : 'black') as 'red' | 'black',
    legalMoves: () => ['h2e2', 'b0c2'],
    applyMove: (_m: string) => fakePosition(fen.includes(' w ') ? fen.replace(' w ', ' b ') : fen.replace(' b ', ' w ')),
    isGameOver: () => ({ over: false as const }),
  }
}
const fakeEngine = { analyze: vi.fn(async (): Promise<EngineLine[]> => [
  { multipv: 1, move: 'b0c2', scoreCp: 20, mate: null, pv: ['b0c2'] },
]) }
function makeSession(repo: GamesRepo) {
  return new GameSession({ repo, engine: fakeEngine as any, makePosition: fakePosition as any, clock: () => new Date().toISOString(), cfg: makeCfg() })
}

test('超时判负:走钟一方剩余归零 → checkTimeout 判对方胜并 finish', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const session = makeSession(repo)
  const gid = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await session.playHumanMove(gid, 'h2e2') // AI 回着后人类开始走钟
  expect(session.checkTimeout(gid)).toBeNull() // 刚起钟,未超时

  // 把红方剩余压到 1ms,再让钟"已经走了 10ms"
  const clock = (session as any).clockStates.get(gid)
  clock.redRemaining = 1
  clock.startedAt = Date.now() - 10

  const out = session.checkTimeout(gid)
  expect(out).not.toBeNull()
  expect(out!.result).toBe('black') // 红超时 → 黑胜
  expect(repo.getGame(gid)!.result).toBe('black')
  expect(session.hasGameState(gid)).toBe(false) // finish 清态
})

test('暂停真停钟:pause 冻结剩余,resume 恢复计时,暂停时长不扣', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const session = makeSession(repo)
  const gid = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await session.playHumanMove(gid, 'h2e2')

  const before = session.getClockState(gid)!.redRemaining
  session.pauseClock(gid)
  // 暂停期间墙钟流逝(模拟):startedAt 已置 null,读数不再变化
  const frozen1 = session.getClockState(gid)!.redRemaining
  await new Promise(r => setTimeout(r, 30))
  const frozen2 = session.getClockState(gid)!.redRemaining
  expect(frozen2).toBe(frozen1)
  expect(before - frozen1).toBeLessThan(200) // 只扣了 pause 前的极短耗时

  session.resumeClock(gid)
  const st = session.getClockState(gid)!
  expect(st.activeSide).toBe('red') // 恢复后红方继续走钟
})

test('悔棋:服务端 3 次上限 + 回滚重复裁决历史(真实 Position)', async () => {
  const { Position, START_FEN } = await import('../rules/position.js')
  const repo = new GamesRepo(openDb(':memory:'))
  // AI(黑)按序回不重复的合法着法
  const blackReplies = ['h9g7', 'b9c7', 'a9a8', 'i9i8']
  let call = 0
  const seqEngine = { analyze: vi.fn(async (): Promise<EngineLine[]> => [
    { multipv: 1, move: blackReplies[call++], scoreCp: 20, mate: null, pv: [] },
  ]) }
  const session = new GameSession({
    repo, engine: seqEngine as any,
    makePosition: (fen: string) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(), cfg: makeCfg(),
  })
  const gid = session.newGame({ mode: 'coach', humanSide: 'red', startFen: START_FEN })

  for (const m of ['h2e2', 'b2d2', 'a0a1', 'i0i1']) await session.playHumanMove(gid, m)
  const historyLenBefore = ((session as any).repeatHistories.get(gid) as unknown[]).length
  expect(historyLenBefore).toBe(9) // 起始 1 + 8 着

  // 3 次成功,第 4 次被上限拒绝
  const r1 = session.undoLastMoves(gid)
  expect(r1.success).toBe(true)
  expect(r1.undoRemaining).toBe(2)
  // 回滚验证:重放后的历史长度 = 起始 1 + 剩余着法数(被撤两手不再残留污染裁决)
  const remainMoves = repo.getMoves(gid).length
  const historyLenAfter = ((session as any).repeatHistories.get(gid) as unknown[]).length
  expect(historyLenAfter).toBe(remainMoves + 1)
  expect(historyLenAfter).toBeLessThan(historyLenBefore)

  expect(session.undoLastMoves(gid).undoRemaining).toBe(1)
  expect(session.undoLastMoves(gid).undoRemaining).toBe(0)
  const r4 = session.undoLastMoves(gid)
  expect(r4.success).toBe(false)
  expect(r4.undoRemaining).toBe(0)
})

test('完局守卫:超时判负后再走子被拒(不复活僵尸局、不写脏着法)', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const session = makeSession(repo)
  const gid = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await session.playHumanMove(gid, 'h2e2')
  // 压红方超时 → checkTimeout 判负 + finish 删态
  const clock = (session as any).clockStates.get(gid)
  clock.redRemaining = 1; clock.startedAt = Date.now() - 10
  expect(session.checkTimeout(gid)!.result).toBe('black')
  const movesAfterFinish = repo.getMoves(gid).length
  // 完局后再走子:必须被拒,且不追加任何着法
  await expect(session.playHumanMove(gid, 'h2e2')).rejects.toThrow('对局已结束')
  expect(repo.getMoves(gid).length).toBe(movesAfterFinish)
})

test('完局守卫:已结束对局不可悔棋(返回 success:false)', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const session = makeSession(repo)
  const gid = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await session.playHumanMove(gid, 'h2e2')
  repo.finishGame(gid, 'black', new Date().toISOString()) // 直接置终局
  const r = session.undoLastMoves(gid)
  expect(r.success).toBe(false)
})

test('非法 startFen:先解析后落库,不产生孤儿 games 行', () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const throwingMakePosition = (fen: string) => {
    if (fen === 'BAD') throw new Error('invalid fen')
    return fakePosition(fen)
  }
  const session = new GameSession({ repo, engine: fakeEngine as any, makePosition: throwingMakePosition as any, clock: () => 't', cfg: makeCfg() })
  expect(() => session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'BAD' })).toThrow()
  expect(repo.listGames()).toHaveLength(0)
})
