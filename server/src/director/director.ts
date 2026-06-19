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

function selectHumanlike(sorted: EngineLine[], _best: EngineLine, ctx: DirectorContext): DirectorDecision {
  // 权重:越靠前(越优)权重越高;strength 越高越集中于最优
  // w_i = exp(-rank_i * k),k 随 strength 增大而增大
  const k = 0.5 + ctx.strength * 4 // strength 0→k0.5(发散), 1→k4.5(集中)
  const weights = sorted.map((_, i) => Math.exp(-i * k))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = ctx.rng() * total
  let idx = 0
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) { idx = i; break }
    idx = i
  }
  const chosen = sorted[idx]
  return {
    move: chosen.move,
    reason: idx === 0 ? '拟人:走我看到的最佳' : '拟人:换个我更顺手的下法',
    chosenLine: chosen,
  }
}

export { MATE_THRESHOLD }
