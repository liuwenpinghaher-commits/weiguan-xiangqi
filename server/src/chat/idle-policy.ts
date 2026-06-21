/** idle 闲话是否该触发:仅在有进行中对局、未暂停、距上一条弹幕沉默够久、且掷骰命中时。 */
export function idleShouldFire(a: {
  hasGame: boolean; paused: boolean; silentMs: number; silenceThresholdMs: number; roll: number; prob: number
}): boolean {
  if (!a.hasGame || a.paused) return false
  if (a.silentMs < a.silenceThresholdMs) return false
  return a.roll < a.prob
}
