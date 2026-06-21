import type { Persona, Stimulus, PersonaId } from '../types.js'

const RECENT_PENALTY_WINDOW_S = 30  // 30 秒内说过则按比例扣分

/**
 * 返回本次刺激下应发言的角色 id(0..maxSpeakers 个,可能为空)。
 * recentMap: personaId -> 距上次发言秒数(越小越该被惩罚);缺失=很久没说。
 * rng: 注入随机扰动,测试可固定。
 * threshold: 综合分超过此值才发言(调高→平淡步多半沉默,只有关键时刻才热闹,制造节奏)。
 * jitterWidth: 个体差异/随机扰动宽度(加宽→节奏更不齐)。
 * maxSpeakers: 本次最多发言人数(按张力分级,高张力可放宽)。
 */
export function pickSpeakers(
  stim: Stimulus, candidates: Persona[],
  recentMap: Map<string, number>, rng: () => number,
  threshold: number, jitterWidth: number, maxSpeakers: number,
): PersonaId[] {
  const scored = candidates.map(p => {
    const base = stim.tension                              // 张力越高越想说
    const jitter = (rng() - 0.5) * jitterWidth             // 个体差异/随机(加宽→节奏更不齐)
    const sinceLast = recentMap.get(p.id)
    const penalty = sinceLast != null && sinceLast < RECENT_PENALTY_WINDOW_S
      ? (1 - sinceLast / RECENT_PENALTY_WINDOW_S) * 0.5
      : 0
    return { id: p.id as PersonaId, score: base + jitter - penalty }
  })
  return scored
    .filter(s => s.score >= threshold)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxSpeakers)
    .map(s => s.id)
}
