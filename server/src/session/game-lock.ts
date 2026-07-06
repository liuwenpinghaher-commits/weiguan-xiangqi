/**
 * 按 gameId 串行化对局写操作的异步互斥。
 *
 * 背景:WS message handler 是 async 且无天然串行化。同一对局的两条写消息
 * (move/undo/resign/draw_offer/AI 先手)会在 `await engine.analyze` 窗口内交错执行——
 * 两次 move 各基于同一局面快照通过守卫、各写一对着法 → moves 表红黑交替断裂、fenAfter 断链;
 * undo 与在途走子交错 → 悔棋后又追加基于旧局面的着法,重放时非法着抛错、对局永久打不开。
 *
 * 用法:`await withGameLock(gid, () => session.playHumanMove(gid, move))`。
 * 后到的同 gid 操作排在前一个(无论成功/失败)之后执行;不同 gid 互不阻塞。
 */
export function createGameLock(): <T>(gid: number, fn: () => Promise<T>) => Promise<T> {
  // 每个 gid 存一条"已吞错"的链尾 Promise,保证前一个操作失败也不断链、且不产生未处理拒绝。
  const tails = new Map<number, Promise<void>>()

  return function withGameLock<T>(gid: number, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(gid) ?? Promise.resolve()
    const cur = prev.then(fn)
    // 排队用的链尾:吞掉错误(仅用于让后续操作等待前一个"完成",不关心成败)。
    const tail = cur.then(() => {}, () => {})
    tails.set(gid, tail)
    // 链尾结算后,若它仍是当前尾则清理,防 Map 随对局数无限增长。
    void tail.then(() => { if (tails.get(gid) === tail) tails.delete(gid) })
    // 返回带真实成败的 cur 给调用方(错误照常抛出)。
    return cur
  }
}
