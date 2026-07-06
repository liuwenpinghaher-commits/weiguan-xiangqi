/**
 * repo.getMoves 的评分片段。scoreCp 是"走子方视角"厘兵分(与 EngineLine.scoreCp 一致,仅 AI
 * 手有值、人手为 null;由 game-session.ts 落库时直接写入,未做红方转换),side 是该手的走子方。
 * buildNarrative 内部会按 side 把 scoreCp 换算成红方视角,不能直接当红方视角使用。
 */
export interface ScoredMove { ply: number; scoreCp: number | null; side: 'red' | 'black' }

/** 超过此厘兵分视为"杀棋级"评分:mate 被 uci-parse 映射为约 ±30000,不能当普通分值打印/比较。 */
const MATE_CP_THRESHOLD = 20000
const isMateCp = (cp: number) => Math.abs(cp) >= MATE_CP_THRESHOLD

/** 把评分序列转成一句"走势 + 最大转折点"叙事,供局势总评/历史回顾做原料;无有效评分返回空串。 */
export function buildNarrative(moves: ScoredMove[]): string {
  const pts = moves
    .filter((m): m is { ply: number; scoreCp: number; side: 'red' | 'black' } => typeof m.scoreCp === 'number')
    // scoreCp 是走子方视角,先按 side 转成红方视角(黑方手需取反),再判断走势/转折——
    // 否则 AI 默认执黑时,谁占优的结论会整体判反。
    .map(m => ({ ply: m.ply, redCp: m.side === 'red' ? m.scoreCp : -m.scoreCp }))
  if (pts.length === 0) return ''

  const last = pts[pts.length - 1]
  // 杀棋级评分单独文字化(否则"红方占优"会盖掉"已成杀势"的分量)。
  const trend = isMateCp(last.redCp) ? (last.redCp > 0 ? '红方已成杀势' : '黑方已成杀势')
    : last.redCp > 200 ? '红方占优' : last.redCp < -200 ? '黑方占优'
    : last.redCp > 60 ? '红方稍好' : last.redCp < -60 ? '黑方稍好' : '大体均势'

  // 最大转折点:相邻评分点(红方视角)跳变绝对值最大处
  let turnPly = 0, turnDelta = 0, turnMate = false
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i].redCp - pts[i - 1].redCp)
    if (d > turnDelta) {
      turnDelta = d; turnPly = pts[i].ply
      turnMate = isMateCp(pts[i].redCp) || isMateCp(pts[i - 1].redCp)
    }
  }

  const parts = [`眼下${trend}(至第${last.ply}手)`]
  if (turnPly > 0 && turnDelta >= 150) {
    // 转折涉及杀棋级评分时,用文字描述而非裸厘兵分(否则会打印"评分骤变29700"这类脏值进 prompt)。
    parts.push(turnMate
      ? `第${turnPly}手是决定性转折(杀棋浮现)`
      : `第${turnPly}手是个转折(评分骤变${Math.round(turnDelta)})`)
  }
  return parts.join(';')
}
