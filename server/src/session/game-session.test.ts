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

// ── 刺激/视角覆盖测试 ──────────────────────────────────────────────────────────
// 这组测试覆盖 playHumanMove 里 onStimulus 分支:redCp 符号、byPlayerPersona、ply。
// 若测试 A 失败说明 redCp 翻转逻辑写反,黑方走子时弹幕评分符号错误。

/** 构造一个 scoreCp 固定为指定值的 fakeEngine */
function makeEngineWithScore(scoreCp: number) {
  return {
    analyze: vi.fn(async (): Promise<EngineLine[]> => [
      { multipv: 1, move: 'b0c2', scoreCp, mate: null, pv: ['b0c2'] },
    ]),
  }
}

test('测试 A — AI 为黑方时 redCp 取反:黑优 80 → 红方视角 -80', async () => {
  // 人类执红(humanSide='red'),startFen 含 ' w ' 表示红先。
  // 人着后局面变为 ' b '，AI 执黑(aiSide='black')。
  // engine 返回 scoreCp=80（AI=黑方视角，黑优 80）。
  // 正确行为：redCp = -aiCp = -80（红方视角，红劣 80）。
  // 若此测试失败且 captured[1].scoreCp === 80，说明实现未取反——是真 bug。
  const repo = new GamesRepo(openDb(':memory:'))
  const captured: import('../types.js').Stimulus[] = []
  const session = new GameSession({
    repo,
    engine: makeEngineWithScore(80) as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    onStimulus: (s) => captured.push(s),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await session.playHumanMove(gameId, 'h2e2')

  // 应触发 2 条刺激:人着 + AI着
  expect(captured).toHaveLength(2)

  // AI 刺激是第二条(byPlayerPersona===true)
  const aiStim = captured[1]
  expect(aiStim.byPlayerPersona).toBe(true)

  // 核心断言:redCp 必须是 -80,而非 +80
  // engine scoreCp=80 是黑方视角(AI=黑方),转为红方视角需取反
  expect(aiStim.scoreCp).toBe(-80)
})

test('测试 B — ply 与 byPlayerPersona 正确', async () => {
  // 人着刺激:byPlayerPersona 未设(undefined 或 falsy);ply=1
  // AI着刺激:byPlayerPersona===true;ply=2
  const repo = new GamesRepo(openDb(':memory:'))
  const captured: import('../types.js').Stimulus[] = []
  const session = new GameSession({
    repo,
    engine: makeEngineWithScore(20) as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    onStimulus: (s) => captured.push(s),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await session.playHumanMove(gameId, 'h2e2')

  expect(captured).toHaveLength(2)

  const humanStim = captured[0]
  const aiStim = captured[1]

  // byPlayerPersona:人着无,AI 着有
  expect(humanStim.byPlayerPersona).toBeFalsy()
  expect(aiStim.byPlayerPersona).toBe(true)

  // ply 连续:人着 ply=1,AI着 ply=2
  expect(humanStim.ply).toBe(1)
  expect(aiStim.ply).toBe(2)

  // side 正确
  expect(humanStim.side).toBe('red')
  expect(aiStim.side).toBe('black')
})

test('测试 C — 非吃子时 AI 张力 ≥ 0.5(fakePosition 无真实 fen 无法触发吃子路径)', async () => {
  // fakePosition 使用假 fen("START w - - 0 1"),describeMoveZh 无法解析,
  // safeDescribeMove 返回 undefined,aiZh 为 undefined,"吃" 分支不触发。
  // 此时 aiBase = max(0.5, min(1, |scoreCp|/300))。
  // scoreCp=150 → aiBase = max(0.5, min(1, 0.5)) = 0.5；非吃子时 aiTension = aiBase = 0.5。
  // 断言：非吃子时 aiTension >= 0.5。
  const repo = new GamesRepo(openDb(':memory:'))
  const captured: import('../types.js').Stimulus[] = []
  const session = new GameSession({
    repo,
    engine: makeEngineWithScore(150) as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    onStimulus: (s) => captured.push(s),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await session.playHumanMove(gameId, 'h2e2')

  expect(captured).toHaveLength(2)
  const aiStim = captured[1]

  // 非吃子(fakePosition 无真实着法描述):张力 >= 0.5
  expect(aiStim.tension).toBeGreaterThanOrEqual(0.5)
  // 并且没有超出合法范围
  expect(aiStim.tension).toBeLessThanOrEqual(1)
})
