import type { GamesRepo } from '../store/games-repo.js'
import type { AnalysisRepo } from '../store/analysis-repo.js'
import type { EngineLine, Side, MoveAnnotation } from '../types.js'
import { cpLoss } from './cploss.js'
import { classifyPhase } from './phase.js'
import { classifyTheme } from './tags.js'
import { accuracyFromAcpl, estimateElo } from './elo.js'

interface EngineLike {
  analyze(fen: string, opts?: { multipv: number; depth?: number; movetime?: number }): Promise<EngineLine[]>
}

export interface DiagnoseDeps {
  games: GamesRepo
  analysis: AnalysisRepo
  engine: EngineLike
  clock: () => string
  depth?: number
}

export interface DiagnoseSummary {
  gameId: number
  annotated: number
  humanSide: Side
  acpl: number
  estElo: number
  blunders: number
  mistakes: number
}

/** 数 FEN 棋盘段里某一方的棋子总数(大写=red,小写=black) */
function countSidePieces(fen: string, side: Side): number {
  const board = fen.split(' ')[0]
  let n = 0
  for (const ch of board) {
    if (!/[a-zA-Z]/.test(ch)) continue
    const isRed = ch === ch.toUpperCase()
    if ((side === 'red') === isRed) n++
  }
  return n
}

export async function diagnoseGame(deps: DiagnoseDeps, gameId: number): Promise<DiagnoseSummary> {
  const game = deps.games.getGame(gameId)
  if (!game) throw new Error(`game not found: ${gameId}`)
  const moves = deps.games.getMoves(gameId)
  if (moves.length === 0) throw new Error(`game has no moves: ${gameId}`)

  const fens = [game.startFen, ...moves.map((m) => m.fenAfter)]
  const depth = deps.depth ?? 12
  const analyses: EngineLine[] = []
  for (const fen of fens) {
    const lines = await deps.engine.analyze(fen, { multipv: 1, depth })
    analyses.push(lines[0])
  }

  for (let i = 0; i < moves.length; i++) {
    const m = moves[i]
    const before = analyses[i]
    const after = analyses[i + 1]
    const loss = cpLoss(before.scoreCp, after.scoreCp)
    const hadMateBefore = before.mate != null && before.mate > 0
    const tookMate = hadMateBefore && m.move === before.move
    const twoLater = fens[i + 2]
    const lostMaterial =
      twoLater != null && countSidePieces(fens[i], m.side) > countSidePieces(twoLater, m.side)

    const annotation: MoveAnnotation = {
      gameId,
      ply: m.ply,
      side: m.side,
      cpLoss: loss,
      bestMove: before.move,
      phase: classifyPhase(m.ply, m.fenAfter),
      theme: classifyTheme({ cpLoss: loss, hadMateBefore, tookMate, lostMaterial }),
    }
    deps.analysis.saveAnnotation(annotation)
  }

  const human = deps.analysis.getAnnotations(gameId).filter((a) => a.side === game.humanSide)
  const mean = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0)
  const acpl = mean(human.map((a) => a.cpLoss))
  const byPhase = (p: string) => mean(human.filter((a) => a.phase === p).map((a) => a.cpLoss))
  const blunders = human.filter(
    (a) => a.theme === 'blunder' || a.theme === 'missed_mate' || a.theme === 'hangs_piece',
  ).length
  const mistakes = human.filter((a) => a.theme === 'mistake').length

  deps.analysis.saveGrowthMetric({
    gameId,
    analyzedAt: deps.clock(),
    humanSide: game.humanSide,
    acpl,
    accuracy: accuracyFromAcpl(acpl),
    estElo: estimateElo(acpl),
    openingAcpl: byPhase('opening'),
    midgameAcpl: byPhase('midgame'),
    endgameAcpl: byPhase('endgame'),
    blunders,
    mistakes,
    result: game.result,
  })

  return { gameId, annotated: moves.length, humanSide: game.humanSide, acpl, estElo: estimateElo(acpl), blunders, mistakes }
}
