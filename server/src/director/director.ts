import type { EngineLine, DirectorContext, DirectorDecision } from '../types.js'

const MATE_THRESHOLD = 29000

export function selectMove(lines: EngineLine[], ctx: DirectorContext): DirectorDecision {
  if (lines.length === 0) throw new Error('no candidate moves')
  const sorted = [...lines].sort((a, b) => b.scoreCp - a.scoreCp)
  const best = sorted[0]

  // 杀棋例外:任何模式都不放过将死
  if (best.mate !== null && best.mate > 0) {
    return { move: best.move, reason: '抓住杀棋,不放水', chosenLine: best }
  }

  if (ctx.mode === 'coach') return selectCoach(sorted, best, ctx)
  return selectHumanlike(sorted, best, ctx)
}

function selectCoach(sorted: EngineLine[], best: EngineLine, ctx: DirectorContext): DirectorDecision {
  const shift = ctx.playerState.lossStreak * -20 + ctx.playerState.winStreak * 15
  const band = { low: ctx.targetBand.low + shift, high: ctx.targetBand.high + shift }

  const allowed = sorted.filter(l => best.scoreCp - l.scoreCp <= ctx.maxDropCp)
  const pool = allowed.length > 0 ? allowed : [best]

  const center = (band.low + band.high) / 2
  const inBand = pool.filter(l => l.scoreCp >= band.low && l.scoreCp <= band.high)
  const chosen = (inBand.length > 0 ? inBand : pool)
    .sort((a, b) => Math.abs(a.scoreCp - center) - Math.abs(b.scoreCp - center))[0]

  const reason = ctx.playerState.lossStreak >= 2
    ? '你最近连败,我稳一手让局面更胶着(未送子)'
    : '保持你跳一跳够得着的局势'
  return { move: chosen.move, reason, chosenLine: chosen }
}

function selectHumanlike(sorted: EngineLine[], best: EngineLine, _ctx: DirectorContext): DirectorDecision {
  // 占位:Task 6 实现并补测;此处先回退最优,保证类型完整
  return { move: best.move, reason: '拟人(待实现)', chosenLine: best }
}

export { MATE_THRESHOLD }
