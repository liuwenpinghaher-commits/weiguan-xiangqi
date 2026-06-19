/** 准确率(0..100):ACPL 指数衰减。常量 300 为启发式,可调。 */
export function accuracyFromAcpl(acpl: number): number {
  return Math.round(100 * Math.exp(-Math.max(0, acpl) / 300) * 10) / 10
}

/** 估算 Elo:分段线性 2600 - 6*ACPL,钳制 [600, 2600]。粗估,可调。 */
export function estimateElo(acpl: number): number {
  const raw = 2600 - acpl * 6
  return Math.max(600, Math.min(2600, Math.round(raw)))
}
