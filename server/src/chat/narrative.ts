/** repo.getMoves 的评分片段(红方视角;仅 AI 手有值,人手 null)。 */
export interface ScoredMove { ply: number; scoreCp: number | null }

/** 把评分序列转成一句"走势 + 最大转折点"叙事,供局势总评/历史回顾做原料;无有效评分返回空串。 */
export function buildNarrative(moves: ScoredMove[]): string {
  const pts = moves.filter((m): m is { ply: number; scoreCp: number } => typeof m.scoreCp === 'number')
  if (pts.length === 0) return ''

  const last = pts[pts.length - 1]
  const trend = last.scoreCp > 200 ? '红方占优' : last.scoreCp < -200 ? '黑方占优'
    : last.scoreCp > 60 ? '红方稍好' : last.scoreCp < -60 ? '黑方稍好' : '大体均势'

  // 最大转折点:相邻评分点跳变绝对值最大处
  let turnPly = 0, turnDelta = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i].scoreCp - pts[i - 1].scoreCp)
    if (d > turnDelta) { turnDelta = d; turnPly = pts[i].ply }
  }

  const parts = [`眼下${trend}(至第${last.ply}手)`]
  if (turnPly > 0 && turnDelta >= 150) parts.push(`第${turnPly}手是个转折(评分骤变${Math.round(turnDelta)})`)
  return parts.join(';')
}
