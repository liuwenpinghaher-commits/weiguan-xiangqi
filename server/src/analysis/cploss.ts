/**
 * 单手丢分用于 ACPL 计算时的上限(厘兵)。
 * mate 被映射为约 ±30000,若不封顶会使单手丢分达 3 万,
 * 拉高 ACPL 均值并把 estElo 钳到最低值 600。
 * 封顶到 1000 保留"漏杀/被将"语义(blunder 阈值仅 300,hangs 阈值 200,
 * missed_mate 靠 mate 标志判定,与封顶值无关)。
 */
export const CPLOSS_CAP = 1000

/**
 * 计算某一手的 centipawn 丢分。
 * @param beforeBestCp 走子前局面引擎最佳着评分(走子方视角)
 * @param afterBestCp  走子后局面引擎最佳着评分(此时轮对手,对手视角)
 * @returns 丢分(>=0,最大 CPLOSS_CAP)。playedValue(走子方视角)= -afterBestCp,
 *          loss = beforeBestCp - playedValue = beforeBestCp + afterBestCp,截断到 0,封顶到 CPLOSS_CAP。
 */
export function cpLoss(beforeBestCp: number, afterBestCp: number): number {
  return Math.min(CPLOSS_CAP, Math.max(0, beforeBestCp + afterBestCp))
}
