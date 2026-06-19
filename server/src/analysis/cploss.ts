/**
 * 计算某一手的 centipawn 丢分。
 * @param beforeBestCp 走子前局面引擎最佳着评分(走子方视角)
 * @param afterBestCp  走子后局面引擎最佳着评分(此时轮对手,对手视角)
 * @returns 丢分(>=0)。playedValue(走子方视角)= -afterBestCp,
 *          loss = beforeBestCp - playedValue = beforeBestCp + afterBestCp,截断到 0。
 */
export function cpLoss(beforeBestCp: number, afterBestCp: number): number {
  return Math.max(0, beforeBestCp + afterBestCp)
}
