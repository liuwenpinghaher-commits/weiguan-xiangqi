import type { PlayerState } from '../types.js'

/**
 * 根据最近战绩、上一手用时和是否刚走出 blunder 计算 PlayerState。
 * recent[0] 为最近一局结果。
 * winStreak:  从 recent[0] 起连续 'win' 的局数,遇到非 'win' 即停。
 * lossStreak: 从 recent[0] 起连续 'loss' 的局数,遇到非 'loss' 即停。
 */
export function computePlayerState(
  recent: Array<'win' | 'loss' | 'draw'>,
  lastMoveMs: number,
  recentBlunder = false,
): PlayerState {
  let winStreak = 0
  for (const r of recent) {
    if (r === 'win') winStreak++
    else break
  }

  let lossStreak = 0
  for (const r of recent) {
    if (r === 'loss') lossStreak++
    else break
  }

  return { winStreak, lossStreak, lastMoveMs, recentBlunder }
}
