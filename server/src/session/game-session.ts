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
  constructor(private deps: GameSessionDeps) {}

  newGame(g: { mode: GameMode; humanSide: Side; startFen: string }): number {
    const id = this.deps.repo.createGame({ ...g, startedAt: this.deps.clock() })
    this.positions.set(id, this.deps.makePosition(g.startFen))
    this.modes.set(id, g.mode)
    return id
  }

  async playHumanMove(gameId: number, move: string): Promise<{ aiMove: string | null; fen: string; over: boolean }> {
    const pos = this.positions.get(gameId)
    if (!pos) throw new Error('game not found')
    if (!pos.legalMoves().includes(move)) throw new Error(`illegal move: ${move}`)

    const after = pos.applyMove(move)
    this.deps.repo.addMove({ gameId, side: pos.sideToMove(), move, fenAfter: after.fen(), scoreCp: null, byAi: false })
    this.positions.set(gameId, after)

    let over = after.isGameOver()
    if (over.over) { this.finish(gameId, over.result!); return { aiMove: null, fen: after.fen(), over: true } }

    const aiMove = await this.playAiMove(gameId)
    const cur = this.positions.get(gameId)!
    over = cur.isGameOver()
    if (over.over) this.finish(gameId, over.result!)
    return { aiMove, fen: cur.fen(), over: over.over }
  }

  private async playAiMove(gameId: number): Promise<string> {
    const pos = this.positions.get(gameId)!
    const lines = await this.deps.engine.analyze(pos.fen(), { multipv: MULTIPV, movetime: 500 })
    const ctx = this.buildContext(gameId)
    const decision = selectMove(lines, ctx)
    const after = pos.applyMove(decision.move)
    this.deps.repo.addMove({ gameId, side: pos.sideToMove(), move: decision.move, fenAfter: after.fen(), scoreCp: decision.chosenLine.scoreCp, byAi: true })
    this.positions.set(gameId, after)
    return decision.move
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
