import type { Drill, MoveAnnotation, Side } from '../types.js'
import type { MoveRow } from '../store/games-repo.js'

export interface DrillInput {
  gameId: number
  humanSide: Side
  startFen: string
  moves: MoveRow[]
  annotations: MoveAnnotation[]
  maxDrills?: number
}

export function generateDrills(input: DrillInput): Drill[] {
  const max = input.maxDrills ?? 5
  const byPly = new Map(input.moves.map((m) => [m.ply, m]))
  const fenBefore = (ply: number): string =>
    ply <= 1 ? input.startFen : byPly.get(ply - 1)?.fenAfter ?? input.startFen

  return input.annotations
    .filter((a) => a.side === input.humanSide && a.theme !== 'ok')
    .sort((a, b) => b.cpLoss - a.cpLoss)
    .slice(0, max)
    .map((a) => ({
      gameId: input.gameId,
      ply: a.ply,
      fen: fenBefore(a.ply),
      bestMove: a.bestMove,
      playedMove: byPly.get(a.ply)?.move ?? '',
      cpLoss: a.cpLoss,
      theme: a.theme,
    }))
}
