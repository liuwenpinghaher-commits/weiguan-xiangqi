import type { GamesRepo } from '../store/games-repo.js'
import type { EngineLine, GameMode, Side, DirectorContext, Stimulus } from '../types.js'
import { selectMove } from '../director/director.js'
import { describeMoveZh } from '../rules/describe-move.js'
import { computePlayerState } from './player-state.js'

interface PositionLike {
  fen(): string
  sideToMove(): Side
  legalMoves(): string[]
  applyMove(move: string): PositionLike
  isGameOver(): { over: boolean; result?: Side | 'draw' }
}
interface EngineLike { analyze(fen: string, opts: { multipv: number; movetime?: number }): Promise<EngineLine[]> }

export interface GameSessionDeps {
  repo: GamesRepo
  engine: EngineLike
  makePosition: (fen: string) => PositionLike
  clock: () => string
  /** 可选:走子后触发聊天刺激 */
  onStimulus?: (s: Stimulus) => void
}

const MULTIPV = 5

/** 根据手数推断对局阶段 */
function calcPhase(ply: number): 'opening' | 'midgame' | 'endgame' {
  if (ply <= 16) return 'opening'
  if (ply <= 60) return 'midgame'
  return 'endgame'
}

/** 安全调用 describeMoveZh,失败返回 undefined(保护假局面/异常不破坏主流程) */
function safeDescribeMove(fenBefore: string, move: string): string | undefined {
  try {
    return describeMoveZh(fenBefore, move)
  } catch {
    return undefined
  }
}

export class GameSession {
  private positions = new Map<number, PositionLike>()
  private modes = new Map<number, GameMode>()
  private humanSides = new Map<number, Side>()
  /** 每局最近一次人类走子的时间戳(毫秒),NaN clock 时不更新 */
  private lastMoveAt = new Map<number, number>()
  /** 每局最近一次人类走子的用时(毫秒),0 表示未知 */
  private lastMoveMs = new Map<number, number>()
  constructor(private deps: GameSessionDeps) {}

  newGame(g: { mode: GameMode; humanSide: Side; startFen: string }): number {
    const id = this.deps.repo.createGame({ ...g, startedAt: this.deps.clock() })
    this.positions.set(id, this.deps.makePosition(g.startFen))
    this.modes.set(id, g.mode)
    this.humanSides.set(id, g.humanSide)
    return id
  }

  async playHumanMove(gameId: number, move: string): Promise<{ aiMove: string | null; fen: string; over: boolean }> {
    const pos = this.positions.get(gameId)
    if (!pos) throw new Error('game not found')

    // 守卫:仅允许 human 一方在轮到自己时走子(不写库、不改状态)
    const humanSide = this.humanSides.get(gameId)!
    const humanTurn = pos.sideToMove()
    if (humanTurn !== humanSide) throw new Error(`not your turn: side to move is ${humanTurn}, human is ${humanSide}`)

    // 1. 校验人着合法(非法则抛,不写库不改状态)
    if (!pos.legalMoves().includes(move)) throw new Error(`illegal move: ${move}`)

    // 记录本次人着时间戳并计算用时(NaN clock 时忽略,防假 clock 破坏状态)
    const nowMs = Date.parse(this.deps.clock())
    if (!Number.isNaN(nowMs)) {
      const prev = this.lastMoveAt.get(gameId)
      this.lastMoveMs.set(gameId, prev !== undefined ? nowMs - prev : 0)
      this.lastMoveAt.set(gameId, nowMs)
    }

    // 2. 纯计算人着后的局面(暂不落库、不 set)
    const beforeFen = pos.fen()
    const humanZh = safeDescribeMove(beforeFen, move)
    const afterHuman = pos.applyMove(move)

    // 3. 人着已直接终局:写人着 → finish → set,返回
    const humanOver = afterHuman.isGameOver()
    if (humanOver.over) {
      this.deps.repo.addMove({ gameId, side: humanTurn, move, fenAfter: afterHuman.fen(), scoreCp: null, byAi: false })
      this.positions.set(gameId, afterHuman)
      this.finish(gameId, humanOver.result!)
      const humanPly = this.deps.repo.getMoves(gameId).length
      const phase = calcPhase(humanPly)
      this.deps.onStimulus?.({
        kind: 'move', gameId, scoreCp: null,
        moveZh: humanZh, side: humanTurn, ply: humanPly, phase,
        tension: humanZh?.includes('吃') ? 0.9 : 0.4,
      })
      return { aiMove: null, fen: afterHuman.fen(), over: true }
    }

    // 4. 计算 AI 回着(此处任何失败都抛出,且尚未写任何库、未改 position,可重试)
    const lines = await this.deps.engine.analyze(afterHuman.fen(), { multipv: MULTIPV, movetime: 500 })
    const ctx = this.buildContext(gameId)
    const decision = selectMove(lines, ctx)
    const aiSide = afterHuman.sideToMove()
    const aiBeforeFen = afterHuman.fen()
    const aiZh = safeDescribeMove(aiBeforeFen, decision.move)
    const afterAI = afterHuman.applyMove(decision.move)

    // 5. 全部成功:一次性写人着、AI 着,set position 为 afterAI,判终局
    this.deps.repo.addMove({ gameId, side: humanTurn, move, fenAfter: afterHuman.fen(), scoreCp: null, byAi: false })
    this.deps.repo.addMove({ gameId, side: aiSide, move: decision.move, fenAfter: afterAI.fen(), scoreCp: decision.chosenLine.scoreCp, byAi: true })
    this.positions.set(gameId, afterAI)

    const allMoves = this.deps.repo.getMoves(gameId)
    const humanPly = allMoves.length - 1  // 人着是倒数第二
    const aiPly = allMoves.length          // AI 着是最后一条
    const humanPhase = calcPhase(humanPly)
    const aiPhase = calcPhase(aiPly)

    // 人着刺激(无评分,红方视角 scoreCp=null)
    this.deps.onStimulus?.({
      kind: 'move', gameId, scoreCp: null,
      moveZh: humanZh, side: humanTurn, ply: humanPly, phase: humanPhase,
      tension: humanZh?.includes('吃') ? 0.9 : 0.55,
    })

    // AI 着刺激:decision.chosenLine.scoreCp 是"AI 走子方视角",转为红方视角
    const aiCp = decision.chosenLine.scoreCp
    // aiSide 是 AI 刚走完这步时的走子方(即 AI 方)
    const redCp = aiSide === 'red' ? aiCp : -aiCp
    const aiTension = Math.max(0.5, Math.min(1,
      Math.abs(aiCp) / 300,
      aiZh?.includes('吃') ? 0.9 : 0,
    ))
    this.deps.onStimulus?.({
      kind: 'move', gameId, scoreCp: redCp,
      moveZh: aiZh, side: aiSide, ply: aiPly, phase: aiPhase,
      tension: aiTension,
      byPlayerPersona: true,
    })

    const aiOver = afterAI.isGameOver()
    if (aiOver.over) this.finish(gameId, aiOver.result!)
    return { aiMove: decision.move, fen: afterAI.fen(), over: aiOver.over }
  }

  private buildContext(gameId: number): DirectorContext {
    const mode = this.modes.get(gameId)!
    const humanSide = this.humanSides.get(gameId)!
    const recent = this.deps.repo.recentResults(humanSide, 10)
    const lastMoveMs = this.lastMoveMs.get(gameId) ?? 0
    const playerState = computePlayerState(recent, lastMoveMs)
    return {
      mode,
      playerState,
      maxDropCp: 320,
      targetBand: { low: -50, high: 80 },
      strength: 0.6,
      rng: Math.random,
    }
  }

  private finish(gameId: number, result: Side | 'draw') {
    this.deps.repo.finishGame(gameId, result, this.deps.clock())
  }
}
