import { test, expect, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { GamesRepo } from '../store/games-repo.js'
import { GameSession } from './game-session.js'
import { Position, START_FEN } from '../rules/position.js'
import { RuntimeConfig } from '../config/runtime-config.js'
import { SettingsRepo } from '../store/settings-repo.js'
import type { EngineLine } from '../types.js'

/** 默认配置(与旧硬编码常量一致:multipv 5 / movetime 500 / maxDropCp 320 / band {-50,80} / strength) */
function makeCfg() {
  return new RuntimeConfig(new SettingsRepo(openDb(':memory:')), () => '2026-06-20T00:00:00.000Z')
}

// Fake 规则:着法即字符串,走两手就结束(便于测编排)
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

test('playHumanMove 落人着并触发 AI 回着,均入库且 ply 连续', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  let t = 0
  const session = new GameSession({
    repo, engine: fakeEngine as any,
    makePosition: fakePosition as any,
    clock: () => `t${t++}`,
    cfg: makeCfg(),
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
  const session = new GameSession({ repo, engine: fakeEngine as any, makePosition: fakePosition as any, clock: () => 't', cfg: makeCfg() })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await expect(session.playHumanMove(gameId, 'z9z9')).rejects.toThrow()
  expect(repo.getMoves(gameId)).toHaveLength(0)
})

test('AI 回着失败时原子回滚:人着不入库、状态不变,重试可成功', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const flaky = { analyze: vi.fn() }
  const session = new GameSession({
    repo, engine: flaky as any, makePosition: fakePosition as any, clock: () => 't', cfg: makeCfg(),
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
  const session = new GameSession({ repo, engine: fakeEngine as any, makePosition: fakePosition as any, clock: () => 't', cfg: makeCfg() })
  // human=red,但起始局面轮到 black 走(fen 含 ' b ')
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START b - - 0 1' })
  await expect(session.playHumanMove(gameId, 'h2e2')).rejects.toThrow(/not your turn/i)
  expect(repo.getMoves(gameId)).toHaveLength(0)
})

test('finish 后清理该 gameId 的全部内存态(防泄漏/复用误判)', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  // 人着后即终局的 fakePosition:applyMove 得到的局面 isGameOver().over=true
  const overPosition = (fen: string): any => ({
    fen: () => fen,
    sideToMove: () => (fen.includes(' w ') ? 'red' : 'black'),
    legalMoves: () => ['h2e2'],
    applyMove: (_m: string) => ({
      ...overPosition(fen.includes(' w ') ? fen.replace(' w ', ' b ') : fen.replace(' b ', ' w ')),
      isGameOver: () => ({ over: true as const, result: 'red' as const }),
    }),
    isGameOver: () => ({ over: false as const }),
  })
  const session = new GameSession({
    repo, engine: fakeEngine as any, makePosition: overPosition,
    clock: () => 't', cfg: makeCfg(),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  expect(session.hasGameState(gameId)).toBe(true)
  const res = await session.playHumanMove(gameId, 'h2e2')
  expect(res.over).toBe(true)
  // 局末:该 gameId 的内存态应全部清空
  expect(session.hasGameState(gameId)).toBe(false)
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
    cfg: makeCfg(),
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
    cfg: makeCfg(),
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
    cfg: makeCfg(),
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

test('humanlike 模式:newGame+playHumanMove 不报错,AI 能从多候选中走子', async () => {
  // fakeEngine 返回 3 条候选，覆盖 selectHumanlike 的加权采样逻辑
  const repo = new GamesRepo(openDb(':memory:'))
  const multiEngine = {
    analyze: vi.fn(async (): Promise<EngineLine[]> => [
      { multipv: 1, move: 'b0c2', scoreCp: 30, mate: null, pv: ['b0c2'] },
      { multipv: 2, move: 'h2e2', scoreCp: 10, mate: null, pv: ['h2e2'] },
      { multipv: 3, move: 'c3c4', scoreCp: -5, mate: null, pv: ['c3c4'] },
    ]),
  }
  const session = new GameSession({
    repo,
    engine: multiEngine as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    cfg: makeCfg(),
  })
  const gameId = session.newGame({ mode: 'humanlike', humanSide: 'red', startFen: 'START w - - 0 1' })

  const res = await session.playHumanMove(gameId, 'h2e2')
  // AI 必须走了某步（humanlike 从候选中采样）
  expect(res.aiMove).toBeTruthy()
  // 人着 + AI 着均入库
  const moves = repo.getMoves(gameId)
  expect(moves).toHaveLength(2)
  expect(moves[0].byAi).toBe(false)
  expect(moves[1].byAi).toBe(true)
  // aiMove 必须是引擎候选之一（采样不越界）
  expect(['b0c2', 'h2e2', 'c3c4']).toContain(res.aiMove)
})

// ── 续局（重启恢复）测试 ────────────────────────────────────────────────────
// 目标：session A 新建对局并走一手后，session B（共享同一 repo、但 positions Map 为空）
// 能对同一 gameId 继续 playHumanMove，证明 ensureLoaded 从 DB 重建内存态。
// 使用真实 Position，fakeEngine 动态返回当前局面第一个合法着（避免非法移动报错）。

/**
 * 构造一个"真实局面合法着"引擎：analyze(fen) 时，解析 fen 的合法着，取第一着返回。
 * 这样无论 session 内部 afterHuman 是什么局面，引擎总能给出一个合法回着。
 */
function makeLegalMoveEngine() {
  return {
    analyze: vi.fn(async (fen: string): Promise<EngineLine[]> => {
      const pos = Position.fromFen(fen)
      const moves = pos.legalMoves()
      if (moves.length === 0) throw new Error('no legal moves in test position')
      return [{ multipv: 1, move: moves[0], scoreCp: 0, mate: null, pv: [moves[0]] }]
    }),
  }
}

test('续局：新 session 共享 repo，对已入库 gameId 可继续 playHumanMove（ensureLoaded 重建内存态）', async () => {
  // 共享同一个 :memory: DB（同一个 db 连接才是同一个内存库）
  const db = openDb(':memory:')
  const repo = new GamesRepo(db)

  // Session A：newGame + 走第一手（红方合法着 h2e2 已经是标准开局着）
  const sessionA = new GameSession({
    repo,
    engine: makeLegalMoveEngine() as any,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
    cfg: makeCfg(),
  })

  const startPos = Position.fromFen(START_FEN)
  const humanMove = startPos.legalMoves()[0]  // 取第一个合法红方着法

  const gameId = sessionA.newGame({ mode: 'coach', humanSide: 'red', startFen: START_FEN })
  await sessionA.playHumanMove(gameId, humanMove)

  // 此时 DB 里已有 2 手（人着 + AI着）
  const movesAfterA = repo.getMoves(gameId)
  expect(movesAfterA).toHaveLength(2)

  // Session B：全新 session，positions Map 为空（模拟重启）
  // 但与 sessionA 共享同一 repo（同一 DB 连接）
  const sessionB = new GameSession({
    repo,
    engine: makeLegalMoveEngine() as any,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
    cfg: makeCfg(),
  })

  // B 的 positions Map 里没有 gameId——若无 ensureLoaded 会抛 'game not found'
  // 从 DB 重建后，当前轮到红方（走了人1着+AI1着，回到红方）
  // 再取一个红方合法着
  const currentFen = movesAfterA[movesAfterA.length - 1].fenAfter
  const currentPos = Position.fromFen(currentFen)
  const nextHumanMove = currentPos.legalMoves()[0]

  // 核心断言：不应抛 'game not found'，应成功返回
  const res = await sessionB.playHumanMove(gameId, nextHumanMove)
  expect(res).toHaveProperty('fen')
  expect(typeof res.fen).toBe('string')

  // DB 里应有 4 手（session B 又写了人着+AI着）
  const movesAfterB = repo.getMoves(gameId)
  expect(movesAfterB).toHaveLength(4)
})

// ── aiFirstMove 测试 ────────────────────────────────────────────────────────
// 场景：humanSide='black'，新建局后红方(AI)应先走一手。
// 使用真实 Position + makeLegalMoveEngine(动态取当前局面合法着)。

test('aiFirstMove：humanSide=black 时，AI 先手走红方一着，入库 by_ai，轮到黑方', async () => {
  const db = openDb(':memory:')
  const repo = new GamesRepo(db)
  const engine = makeLegalMoveEngine()

  const session = new GameSession({
    repo,
    engine: engine as any,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
    cfg: makeCfg(),
  })

  const gameId = session.newGame({ mode: 'coach', humanSide: 'black', startFen: START_FEN })

  // 调用 aiFirstMove — 此时该红方走，AI 是红方
  const res = await session.aiFirstMove(gameId)

  // 1. 返回合法 aiMove 字符串
  expect(typeof res.aiMove).toBe('string')
  expect(res.aiMove.length).toBeGreaterThan(0)
  // 2. 入库一条 by_ai
  const moves = repo.getMoves(gameId)
  expect(moves).toHaveLength(1)
  expect(moves[0].byAi).toBe(true)
  expect(moves[0].side).toBe('red')
  // 3. 走完后轮到黑方（即 humanSide）
  const posAfter = Position.fromFen(moves[0].fenAfter)
  expect(posAfter.sideToMove()).toBe('black')
  // 4. 返回的 fen 与入库 fenAfter 一致
  expect(res.fen).toBe(moves[0].fenAfter)
  // 5. over=false（开局第一手不会终局）
  expect(res.over).toBe(false)
})

test('aiFirstMove：humanSide=red 时（轮到人走），抛出错误', async () => {
  const db = openDb(':memory:')
  const repo = new GamesRepo(db)

  const session = new GameSession({
    repo,
    engine: makeLegalMoveEngine() as any,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
    cfg: makeCfg(),
  })

  // humanSide=red，开局轮到红方，即 humanSide 先走，不应由 AI 走
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: START_FEN })

  await expect(session.aiFirstMove(gameId)).rejects.toThrow(/not AI turn/i)
})

// ── 叙事刺激：turning_point / phase_shift ──────────────────────────────────
// 覆盖 playHumanMove 里 AI 着 onStimulus 之后追加的两条低频"不丢"叙事刺激：
// 评分大摆动(|aiSwing|>=250)→ turning_point；阶段切换(aiPhase 变化)→ phase_shift。

/** 构造一个按调用顺序依次返回不同 scoreCp 的 fakeEngine(用于制造可控评分摆幅)。*/
function makeEngineWithScoreSequence(scores: number[]) {
  let i = 0
  return {
    analyze: vi.fn(async (): Promise<EngineLine[]> => {
      const scoreCp = scores[Math.min(i, scores.length - 1)]
      i++
      return [{ multipv: 1, move: 'b0c2', scoreCp, mate: null, pv: ['b0c2'] }]
    }),
  }
}

test('AI 着评分大摆动(|aiSwing|>=250)→ 追加 turning_point 刺激', async () => {
  // aiSide 全程为 black(fakePosition 每手翻转 w/b，human=red 恒定，AI 恒为 black)。
  // 第一手：prevRedCp 尚无前值 → aiSwing=null，不触发。
  // 第二手：aiCp 从 0 摆到 300 → redCp 从 0 摆到 -300 → aiSwing = -(-300-0) = 300，|aiSwing|=300>=250。
  const repo = new GamesRepo(openDb(':memory:'))
  const captured: any[] = []
  const session = new GameSession({
    repo,
    engine: makeEngineWithScoreSequence([0, 300]) as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    onStimulus: (s) => captured.push(s),
    cfg: makeCfg(),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })

  await session.playHumanMove(gameId, 'h2e2')
  await session.playHumanMove(gameId, 'h2e2')

  const kinds = captured.map((s: any) => s.kind)
  expect(kinds).toContain('turning_point')

  const tp = captured.find((s: any) => s.kind === 'turning_point')
  expect(tp.scoreCp).toBe(-300)
  expect(tp.tension).toBe(0.95)
})

test('AI 着评分摆幅不足(|aiSwing|<250)→ 不追加 turning_point 刺激', async () => {
  // 第一手 aiCp=0，第二手 aiCp=100 → |aiSwing|=100 < 250，不应触发 turning_point。
  const repo = new GamesRepo(openDb(':memory:'))
  const captured: any[] = []
  const session = new GameSession({
    repo,
    engine: makeEngineWithScoreSequence([0, 100]) as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    onStimulus: (s) => captured.push(s),
    cfg: makeCfg(),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })

  await session.playHumanMove(gameId, 'h2e2')
  await session.playHumanMove(gameId, 'h2e2')

  const kinds = captured.map((s: any) => s.kind)
  expect(kinds).not.toContain('turning_point')
})

test('AI 着阶段切换(opening→midgame)→ 追加 phase_shift 刺激', async () => {
  // 每次 playHumanMove 落人着+AI着共 2 手，aiPly 依次为 2,4,...,16,18。
  // calcPhase(16)='opening'，calcPhase(18)='midgame'：第 9 轮跨越边界，触发 phase_shift。
  const repo = new GamesRepo(openDb(':memory:'))
  const captured: any[] = []
  const session = new GameSession({
    repo,
    engine: fakeEngine as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    onStimulus: (s) => captured.push(s),
    cfg: makeCfg(),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })

  for (let i = 0; i < 9; i++) {
    await session.playHumanMove(gameId, 'h2e2')
  }

  const kinds = captured.map((s: any) => s.kind)
  expect(kinds).toContain('phase_shift')

  const shift = captured.find((s: any) => s.kind === 'phase_shift')
  expect(shift.phase).toBe('midgame')
  expect(shift.tension).toBe(0.7)
  // M2 回归:phase_shift 应与 turning_point 对称携带 moveZh 字段(供老黑 chime-in 分支——
  // 该分支 gated on stim.moveZh != null——同样能在阶段切换时触发)。用 hasOwnProperty 而非
  // 真值判断:fakePosition 不是合法 FEN,describeMoveZh 会失败降级为 undefined,但字段本身
  // 必须存在(修复前 phase_shift 字面量根本不含 moveZh 这个 key)。
  expect(Object.prototype.hasOwnProperty.call(shift, 'moveZh')).toBe(true)
})

test('同阶段内连续走子 → 不重复追加 phase_shift 刺激', async () => {
  // 8 轮走子：aiPly 依次 2,4,...,16，全程停留在 opening 阶段，不应触发 phase_shift。
  const repo = new GamesRepo(openDb(':memory:'))
  const captured: any[] = []
  const session = new GameSession({
    repo,
    engine: fakeEngine as any,
    makePosition: fakePosition as any,
    clock: () => 't',
    onStimulus: (s) => captured.push(s),
    cfg: makeCfg(),
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })

  for (let i = 0; i < 8; i++) {
    await session.playHumanMove(gameId, 'h2e2')
  }

  const kinds = captured.map((s: any) => s.kind)
  expect(kinds).not.toContain('phase_shift')
})
