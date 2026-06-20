import type { StimulusKind } from '../types.js'

/**
 * 根据评分摆幅、是否吃子、人着用时，分类这一手的刺激类型。
 *
 * @param swingForMover  走子方视角的评分变化 = afterCp - beforeCp（对走子方有利为正）。
 *                       换言之：走子方走完这步后，走子方获益多少厘兵分。
 *                       若 swing 极负（≤-150），说明走子方自损 → blunder。
 *                       若 swing 极正（≥+150），说明走子方获大利 → brilliant。
 * @param isCapture      本手是否为吃子（影响 tension，不影响 kind）
 * @param lastMoveMs     人着用时（毫秒）；仅对人着有意义，AI 着传 0 即可。
 *                       > 8000ms 且非 blunder/brilliant 时触发 long_think。
 */
export function classifyMoveKind(
  swingForMover: number,
  _isCapture: boolean,
  lastMoveMs: number,
): StimulusKind {
  // blunder / brilliant 优先级最高
  if (swingForMover <= -150) return 'blunder'
  if (swingForMover >= 150)  return 'brilliant'
  // 长考次之
  if (lastMoveMs > 8000) return 'long_think'
  // 其余（含吃子）统一 move；吃子张力由调用方提升
  return 'move'
}

/**
 * 根据 kind 决定基础 tension 值（调用方可进一步叠加吃子溢价）。
 */
export function baseTensionForKind(kind: StimulusKind): number {
  switch (kind) {
    case 'blunder':    return 0.95
    case 'brilliant':  return 0.95
    case 'long_think': return 0.70
    default:           return 0.50
  }
}
