/**
 * 终局裁决纯函数 — 三次重复局面 / 60 回合判和 / 长将判负
 *
 * 已知简化（KNOWN SIMPLIFICATIONS）:
 *   1. 不实现"长捉"（perpetual chase）。象棋完整规则中长捉方同样判负，
 *      但需额外检测棋子是否持续攻击对方有价值棋子，复杂度高且工程收益有限。
 *      当前版本仅处理"长将"（perpetual check）。
 *   2. "持续将军"用"该方在每次该局面出现时 checked 标志均为 true"近似，
 *      而非精确统计循环窗口内每一半步。
 */

/** 每一手后记录的局面信息 */
export interface RepeatInfo {
  /** 去重键：棋盘布局 + 走子方（忽略步数计数）*/
  key: string
  /** 红方走完这步时是否将军了对方（即轮到黑方时局面是否被将） */
  redChecked: boolean
  /** 黑方走完这步时是否将军了对方（即轮到红方时局面是否被将） */
  blackChecked: boolean
}

/**
 * 根据历史局面序列和无吃子半步数判断终局裁决。
 *
 * @param history - 从最早到最新的 RepeatInfo 列表（含初始局面）
 * @param pliesSinceCapture - 自上次吃子（或开局）以来的半步数
 * @returns 裁决对象，或 null（继续对弈）
 */
export function adjudicate(
  history: RepeatInfo[],
  pliesSinceCapture: number,
): { result: 'red' | 'black' | 'draw' } | null {
  // ── 规则 1：60 回合判和（120 半步无吃子）─────────────────────────────────
  if (pliesSinceCapture >= 120) {
    return { result: 'draw' }
  }

  // ── 规则 2：三次重复局面 ──────────────────────────────────────────────────
  // 统计每个 key 出现的所有索引
  const keyIndices = new Map<string, number[]>()
  for (let i = 0; i < history.length; i++) {
    const k = history[i].key
    if (!keyIndices.has(k)) keyIndices.set(k, [])
    keyIndices.get(k)!.push(i)
  }

  for (const [, indices] of keyIndices) {
    if (indices.length < 3) continue

    // 取最近 3 次出现的 RepeatInfo（用最近窗口判定"是否持续将军"）
    const last3 = indices.slice(-3).map(i => history[i])

    // 判断哪方在这 3 次出现中每次都在将军对方
    const redAlwaysChecked = last3.every(r => r.redChecked)
    const blackAlwaysChecked = last3.every(r => r.blackChecked)

    if (redAlwaysChecked && !blackAlwaysChecked) {
      // 红方长将 → 红方判负
      return { result: 'black' }
    }
    if (blackAlwaysChecked && !redAlwaysChecked) {
      // 黑方长将 → 黑方判负
      return { result: 'red' }
    }
    // 双方都将 或 双方都不将 → 判和
    return { result: 'draw' }
  }

  return null
}
