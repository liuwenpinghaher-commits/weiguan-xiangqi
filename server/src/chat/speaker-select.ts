import type { Persona, Stimulus, PersonaId } from '../types.js'

const RECENT_PENALTY_WINDOW_S = 30  // 30 秒内说过则按比例扣分
const SPEAK_THRESHOLD = 0.45        // 综合分超过此值才发言
const MAX_SPEAKERS = 2

/**
 * 返回本次刺激下应发言的角色 id(0..MAX_SPEAKERS 个,可能为空)。
 * recentMap: personaId -> 距上次发言秒数(越小越该被惩罚);缺失=很久没说。
 * rng: 注入随机扰动,测试可固定。
 */
export function pickSpeakers(
  stim: Stimulus, candidates: Persona[],
  recentMap: Map<string, number>, rng: () => number,
): PersonaId[] {
  const scored = candidates.map(p => {
    const base = stim.tension                              // 张力越高越想说
    const jitter = (rng() - 0.5) * 0.3                     // 个体差异/随机
    const sinceLast = recentMap.get(p.id)
    const penalty = sinceLast != null && sinceLast < RECENT_PENALTY_WINDOW_S
      ? (1 - sinceLast / RECENT_PENALTY_WINDOW_S) * 0.5
      : 0
    return { id: p.id as PersonaId, score: base + jitter - penalty }
  })
  return scored
    .filter(s => s.score >= SPEAK_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SPEAKERS)
    .map(s => s.id)
}
