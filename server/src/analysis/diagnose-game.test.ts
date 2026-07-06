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

test('中局某局面返回空数组(非终局)→ 抛清晰错误,不崩在下游 scoreCp', async () => {
  const db = openDb(':memory:')
  const games = new GamesRepo(db)
  const analysis = new AnalysisRepo(db)
  const gameId = games.createGame({ mode: 'coach', humanSide: 'red', startFen: `${F}/s0 w`, startedAt: 't' })
  games.addMove({ gameId, side: 'red', move: 'm1', fenAfter: `${F}/s1 b`, scoreCp: null, byAi: false })
  games.addMove({ gameId, side: 'black', move: 'm2', fenAfter: `${F}/s2 w`, scoreCp: 30, byAi: true })
  games.finishGame(gameId, 'black', 't2')

  const evals: Record<string, EngineLine[]> = {
    [`${F}/s0 w`]: line('b0c2', 50),
    [`${F}/s1 b`]: [], // 中间局面引擎返回空主变(真·引擎故障,非终局)
    [`${F}/s2 w`]: line('y', 40),
  }
  const engine = { analyze: vi.fn(async (fen: string) => evals[fen]) }
  await expect(
    diagnoseGame({ games, analysis, engine, clock: () => 't' }, gameId),
  ).rejects.toThrow(/引擎分析返回空/)
  db.close()
})

test('终局将死局面(末 FEN 无主变/bestmove none)→ 合成终局评分,诊断成功产出成长指标', async () => {
  // 将死取胜:红方末手 m3 将死黑方,末 FEN(s3,轮黑走)引擎返回空(mate 0 无 pv)。
  // 期望:不抛错;末手 after 合成为"走子方(黑)被将死"= -MATE_BASE,红方将杀手 cpLoss=0。
  const db = openDb(':memory:')
  const games = new GamesRepo(db)
  const analysis = new AnalysisRepo(db)
  const gameId = games.createGame({ mode: 'coach', humanSide: 'red', startFen: `${F}/s0 w`, startedAt: 't' })
  games.addMove({ gameId, side: 'red', move: 'm1', fenAfter: `${F}/s1 b`, scoreCp: null, byAi: false })
  games.addMove({ gameId, side: 'black', move: 'm2', fenAfter: `${F}/s2 w`, scoreCp: 30, byAi: true })
  games.addMove({ gameId, side: 'red', move: 'kill', fenAfter: `${F}/s3 b`, scoreCp: null, byAi: false })
  games.finishGame(gameId, 'red', 't2')

  const evals: Record<string, EngineLine[]> = {
    [`${F}/s0 w`]: line('b0c2', 50),
    [`${F}/s1 b`]: line('x', -30),
    // 红走前:引擎发现红有 1 步杀,最佳着 = kill
    [`${F}/s2 w`]: [{ multipv: 1, move: 'kill', scoreCp: 29999, mate: 1, pv: ['kill'] }],
    [`${F}/s3 b`]: [], // 终局:黑被将死,引擎无主变
  }
  const engine = { analyze: vi.fn(async (fen: string) => evals[fen]) }

  const sum = await diagnoseGame({ games, analysis, engine, clock: () => 'tA' }, gameId)

  const ann = analysis.getAnnotations(gameId)
  expect(ann.map((a) => a.ply)).toEqual([1, 2, 3])
  // 红方将杀手(ply3):before=29999(红有杀),after=终局黑被将死=-30000 → cpLoss=max(0,-1)=0
  const kill = ann.find((a) => a.ply === 3)!
  expect(kill.cpLoss).toBe(0)
  // 成长指标真实产出(不再因末 FEN 空而整局失败)
  const g = analysis.getGrowthMetric(gameId)!
  expect(g.result).toBe('red')
  expect(sum.annotated).toBe(3)
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

test('单手漏杀(mate 极值)不污染 ACPL:封顶后 acpl 合理,不被单次 mate 拉到万级', async () => {
  // 构造红黑交替 4 手:红1-黑2-红3-黑4,humanSide=red → acpl 只算红方 2 手(ply1,ply3)
  //
  // 局面时间轴(FEN 下标):
  //   fens[0]=s0(startFen,红走) → 红手ply1(m1) → fens[1]=s1(黑走)
  //   fens[1]=s1(黑走)          → 黑手ply2(m2) → fens[2]=s2(红走,引擎发现红有 mate=3)
  //   fens[2]=s2(红走,mate=3)   → 红手ply3(m3,漏掉杀棋) → fens[3]=s3(黑走)
  //   fens[3]=s3(黑走)          → 黑手ply4(m4) → fens[4]=s4(红走)
  //
  // cpLoss 各手(封顶后):
  //   ply1(红): max(0, 50+(-30))=20  → min(1000,20)=20
  //   ply2(黑): max(0,-30+29997)=29967 → min(1000,29967)=1000  (不入 red acpl)
  //   ply3(红): max(0,29997+200)=30197 → min(1000,30197)=1000  ← 封顶生效,漏杀场景
  //   ply4(黑): max(0,200+(-30))=170  → min(1000,170)=170      (不入 red acpl)
  //
  // red acpl = round((20+1000)/2) = 510
  // 封顶前 ply3 = 30197 → red acpl = round((20+30197)/2)=15108 → estElo 被钳到 600 且完全失真
  // 封顶后 ply3 = 1000  → red acpl = 510,真实反映水平

  const db = openDb(':memory:')
  const games = new GamesRepo(db)
  const analysis = new AnalysisRepo(db)
  const BRD = 'RRNNCCrrnnccKk'
  const gameId = games.createGame({ mode: 'coach', humanSide: 'red', startFen: `${BRD}/s0 w`, startedAt: 't' })
  games.addMove({ gameId, side: 'red',   move: 'm1', fenAfter: `${BRD}/s1 b`, scoreCp: null, byAi: false })
  games.addMove({ gameId, side: 'black', move: 'm2', fenAfter: `${BRD}/s2 w`, scoreCp: null, byAi: true  })
  games.addMove({ gameId, side: 'red',   move: 'm3', fenAfter: `${BRD}/s3 b`, scoreCp: null, byAi: false })
  games.addMove({ gameId, side: 'black', move: 'm4', fenAfter: `${BRD}/s4 w`, scoreCp: null, byAi: true  })
  games.finishGame(gameId, 'black', 't2')

  const evals: Record<string, EngineLine[]> = {
    [`${BRD}/s0 w`]: [{ multipv: 1, move: 'b0c2',     scoreCp: 50,    mate: null, pv: ['b0c2']      }],
    [`${BRD}/s1 b`]: [{ multipv: 1, move: 'x',         scoreCp: -30,   mate: null, pv: ['x']         }],
    // 引擎发现红有 3 步杀;红方实走 m3 !== kill_move → 触发 missed_mate
    [`${BRD}/s2 w`]: [{ multipv: 1, move: 'kill_move', scoreCp: 29997, mate: 3,    pv: ['kill_move'] }],
    [`${BRD}/s3 b`]: [{ multipv: 1, move: 'z',         scoreCp: 200,   mate: null, pv: ['z']         }],
    [`${BRD}/s4 w`]: [{ multipv: 1, move: 'w',         scoreCp: -30,   mate: null, pv: ['w']         }],
  }
  const engine = { analyze: vi.fn(async (fen: string) => evals[fen]) }

  const sum = await diagnoseGame({ games, analysis, engine, clock: () => 'tB' }, gameId)
  const ann = analysis.getAnnotations(gameId)

  // 1. 封顶有效:red acpl 不到万级
  expect(sum.acpl).toBeLessThanOrEqual(1000)
  // 2. 精确值验证:red 2 手 cpLoss=[20,1000] → acpl=510
  expect(sum.acpl).toBe(510)
  // 3. ply3(红方漏杀手)的 cpLoss 被封顶到 1000
  const ply3 = ann.find((a) => a.ply === 3)!
  expect(ply3.cpLoss).toBe(1000)
  // 4. missed_mate 标签靠 mate 标志(hadMateBefore && !tookMate),不靠 cpLoss 精确大值 → 封顶不影响标签
  expect(ply3.theme).toBe('missed_mate')
  // 5. ply1 正常丢分不受封顶影响
  const ply1 = ann.find((a) => a.ply === 1)!
  expect(ply1.cpLoss).toBe(20)
  db.close()
})
