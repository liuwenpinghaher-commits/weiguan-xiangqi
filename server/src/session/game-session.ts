import type { GamesRepo } from '../store/games-repo.js'
import type { EngineLine, GameMode, Side, DirectorContext } from '../types.js'
import { selectMove } from '../director/director.js'

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
}

const MULTIPV = 5

export class GameSession {
  private positions = new Map<number, PositionLike>()
  private modes = new Map<number, GameMode>()
  private humanSides = new Map<number, Side>()
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

    // 2. 纯计算人着后的局面(暂不落库、不 set)
    const afterHuman = pos.applyMove(move)

    // 3. 人着已直接终局:写人着 → finish → set,返回
    const humanOver = afterHuman.isGameOver()
    if (humanOver.over) {
      this.deps.repo.addMove({ gameId, side: humanTurn, move, fenAfter: afterHuman.fen(), scoreCp: null, byAi: false })
      this.positions.set(gameId, afterHuman)
      this.finish(gameId, humanOver.result!)
      return { aiMove: null, fen: afterHuman.fen(), over: true }
    }

    // 4. 计算 AI 回着(此处任何失败都抛出,且尚未写任何库、未改 position,可重试)
    const lines = await this.deps.engine.analyze(afterHuman.fen(), { multipv: MULTIPV, movetime: 500 })
    const ctx = this.buildContext(gameId)
    const decision = selectMove(lines, ctx)
    const aiSide = afterHuman.sideToMove()
    const afterAI = afterHuman.applyMove(decision.move)

    // 5. 全部成功:一次性写人着、AI 着,set position 为 afterAI,判终局
    this.deps.repo.addMove({ gameId, side: humanTurn, move, fenAfter: afterHuman.fen(), scoreCp: null, byAi: false })
    this.deps.repo.addMove({ gameId, side: aiSide, move: decision.move, fenAfter: afterAI.fen(), scoreCp: decision.chosenLine.scoreCp, byAi: true })
    this.positions.set(gameId, afterAI)

    const aiOver = afterAI.isGameOver()
    if (aiOver.over) this.finish(gameId, aiOver.result!)
    return { aiMove: decision.move, fen: afterAI.fen(), over: aiOver.over }
  }

  private buildContext(gameId: number): DirectorContext {
    const mode = this.modes.get(gameId)!
    return {
      mode,
      playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 },
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
