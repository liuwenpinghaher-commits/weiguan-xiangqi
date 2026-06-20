import type { GameRow, MoveRow } from '../store/games-repo.js'
import type { MoveAnnotation, Side } from '../types.js'

/**
 * 返回第 ply 手走棋之前的局面 FEN。
 *
 * - ply === 1：走子前是对局起始局面，返回 game.startFen
 * - ply > 1：返回第 ply-1 手走完后的 fenAfter
 * - 若找不到 ply-1（列表比预期短）：回退到 game.startFen
 */
export function prevFenForPly(game: GameRow, moves: MoveRow[], ply: number): string {
  if (ply <= 1) return game.startFen
  const prev = moves.find((m) => m.ply === ply - 1)
  return prev?.fenAfter ?? game.startFen
}

/**
 * 从诊断标注中找到人方 cp_loss 最大的那一手的 ply。
 * 若无人方标注则返回 null。
 */
export function worstHumanPly(annotations: MoveAnnotation[], humanSide: Side): number | null {
  const humanAnns = annotations.filter((a) => a.side === humanSide)
  if (humanAnns.length === 0) return null
  const worst = humanAnns.reduce((max, a) => (a.cpLoss > max.cpLoss ? a : max))
  return worst.ply
}
