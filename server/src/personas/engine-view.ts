import type { SkillTier } from '../types.js'

/** 各档最大加噪幅度(厘兵):strong≈0(看得准),weak 最大(常看走眼) */
const NOISE_CP: Record<SkillTier, number> = { strong: 0, medium: 60, weak: 200 }

/**
 * 把"真值评分"降级为某档角色"看到的评分"。
 * rng() ∈ [0,1):映射到 [-noise, +noise] 的对称偏移。
 */
export function viewScore(trueCp: number | null, tier: SkillTier, rng: () => number): number | null {
  if (trueCp === null) return null
  const noise = NOISE_CP[tier]
  if (noise === 0) return trueCp
  const offset = Math.round((rng() * 2 - 1) * noise)
  return trueCp + offset
}
