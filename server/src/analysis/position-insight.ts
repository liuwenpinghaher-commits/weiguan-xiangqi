import type { EngineInsight, EngineLine } from '../types.js'
import { Position } from '../rules/position.js'
import { describeMoveZh } from '../rules/describe-move.js'

interface EngineLike {
  analyze(fen: string, opts: { multipv: number; movetime?: number; depth?: number }): Promise<EngineLine[]>
}

/** 沿 pv 逐手推进 FEN 并转中文,最多取 maxPlies 手;任一步解析失败即止。 */
function pvToZh(fen: string, pv: string[], maxPlies: number): string[] {
  const out: string[] = []
  let cur = fen
  for (const mv of pv.slice(0, maxPlies)) {
    try {
      out.push(describeMoveZh(cur, mv))
      cur = Position.fromFen(cur).applyMove(mv).fen()
    } catch {
      break
    }
  }
  return out
}

/**
 * 取当前局面的引擎洞察(coach_query 用)。评分统一转红方视角。
 * 引擎缺失/抛错/无候选 → 返回 null,上层降级为纯 LLM 作答。
 */
export async function buildPositionInsight(
  engine: EngineLike,
  fen: string,
  movetime: number,
): Promise<EngineInsight | null> {
  let lines: EngineLine[]
  try {
    lines = await engine.analyze(fen, { multipv: 1, movetime })
  } catch {
    return null
  }
  const top = lines[0]
  if (!top) return null

  // scoreCp 是走子方视角;黑方走子时翻转为红方视角(与 Stimulus.scoreCp 口径一致)
  let blackToMove: boolean
  try {
    blackToMove = Position.fromFen(fen).sideToMove() === 'black'
  } catch {
    return null  // 非法 fen → 降级,不抛
  }
  const evalCp = blackToMove ? -top.scoreCp : top.scoreCp
  const mate = top.mate == null ? null : (blackToMove ? -top.mate : top.mate)

  let bestMoveZh: string | null = null
  try { bestMoveZh = describeMoveZh(fen, top.move) } catch { bestMoveZh = null }

  return { evalCp, bestMoveZh, pvZh: pvToZh(fen, top.pv, 3), mate }
}
