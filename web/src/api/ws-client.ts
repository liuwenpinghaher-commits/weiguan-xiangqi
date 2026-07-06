import { WS_BASE } from './config.js'

export type ServerMsg =
  | { type: 'started'; gameId: number }
  | { type: 'update'; gameId?: number; aiMove: string | null; fen: string; over: boolean; result?: 'red' | 'black' | 'draw'; aiReason?: string; moveZh?: string; aiMoveZh?: string; clockState?: { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null } | null }
  | { type: 'state'; gameId: number; fen: string; clockState: { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null } | null; over: boolean; result?: 'red' | 'black' | 'draw' }
  | { type: 'error'; message: string }
  | { type: 'chat'; gameId: number; personaId: string; text: string; addressee: string; ts: string }
  | { type: 'draw_response'; gameId: number; accepted: boolean }
  | { type: 'undo_result'; gameId: number; success: boolean; fen?: string; undoRemaining?: number; clockState?: { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null } }

/** 出站帧契约(与 ws-server 消息分派对应),send 收窄到此类型获得编译期校验 */
export type ClientMsg =
  | { type: 'new'; mode: 'coach' | 'humanlike'; humanSide: 'red' | 'black'; startFen?: string; spectators?: boolean }
  | { type: 'move'; gameId: number; move: string }
  | { type: 'say'; gameId: number; text: string }
  | { type: 'pause'; gameId: number }
  | { type: 'resume'; gameId: number }
  | { type: 'spectators'; gameId: number; enabled: boolean }
  | { type: 'resign'; gameId: number }
  | { type: 'draw_offer'; gameId: number }
  | { type: 'undo'; gameId: number }
  | { type: 'resync'; gameId: number }

export type ConnStatus = 'open' | 'closed' | 'error' | 'reconnecting'

/** 指数退避重连参数 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

export function connect(
  onMsg: (m: ServerMsg) => void,
  onStatus?: (s: ConnStatus) => void,
): { send: (m: ClientMsg) => void; close: () => void } {
  let ws: WebSocket
  let intentionallyClosed = false
  // 重连彻底失败后置 true:此后 send 直接丢弃,不再入队(防 pendingQueue 无界增长泄漏)。
  let dead = false
  let retryCount = 0
  // 连接未就绪(CONNECTING / 重连中)时排队,onopen 时一次性 flush。
  // 用单一队列(而非旧 ws 的 once 监听):重连换 ws 后旧 once 永不触发会静默丢消息。
  let pendingQueue: string[] = []

  function createWs() {
    ws = new WebSocket(`${WS_BASE}/play`)

    ws.onopen = () => {
      retryCount = 0
      onStatus?.('open')
      // flush 排队消息(取出后清空,确保每条只发一次、重连后不重复)
      if (pendingQueue.length > 0) {
        const toSend = pendingQueue
        pendingQueue = []
        for (const m of toSend) ws.send(m)
      }
    }

    ws.onmessage = (e) => {
      let parsed: ServerMsg
      try {
        parsed = JSON.parse(e.data) as ServerMsg
      } catch (err) {
        console.warn('[ws-client] 无法解析消息:', e.data, err)
        return
      }
      onMsg(parsed)
    }

    ws.onerror = () => {
      // onerror 后总会触发 onclose，在 onclose 里处理重连
    }

    ws.onclose = () => {
      if (intentionallyClosed) {
        onStatus?.('closed')
        return
      }
      // 非主动关闭：尝试指数退避重连
      if (retryCount < RECONNECT_DELAYS_MS.length) {
        const delay = RECONNECT_DELAYS_MS[retryCount]
        retryCount++
        onStatus?.('reconnecting')
        setTimeout(() => {
          if (!intentionallyClosed) {
            createWs()
          }
        }, delay)
      } else {
        // 重连次数耗尽，彻底失败:标记 dead,清空积压队列,此后 send 直接丢弃。
        dead = true
        pendingQueue = []
        onStatus?.('closed')
      }
    }
  }

  createWs()

  return {
    send: (m) => {
      const data = JSON.stringify(m)
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data)
      } else if (intentionallyClosed || dead) {
        // 已主动关闭 或 重连彻底失败：不再排队,丢弃并警告(防队列无界增长)
        console.warn('[ws-client] 连接已关闭，消息已丢弃:', m)
      } else {
        // CONNECTING 或重连中(CLOSING/CLOSED 等待 setTimeout 重连):
        // 入队,待下次 onopen 一次性 flush(避免旧 ws 的 once 监听因重连换 ws 而永不触发)
        pendingQueue.push(data)
      }
    },
    close: () => {
      intentionallyClosed = true
      ws.close()
    },
  }
}
