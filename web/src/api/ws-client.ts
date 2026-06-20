import { WS_BASE } from './config.js'

export type ServerMsg =
  | { type: 'started'; gameId: number }
  | { type: 'update'; aiMove: string | null; fen: string; over: boolean; result?: 'red' | 'black' | 'draw' }
  | { type: 'error'; message: string }
  | { type: 'chat'; gameId: number; personaId: string; text: string; addressee: string; ts: string }

export type ConnStatus = 'open' | 'closed' | 'error' | 'reconnecting'

/** 指数退避重连参数 */
const RECONNECT_DELAYS_MS = [500, 1000, 2000, 4000, 8000]

export function connect(
  onMsg: (m: ServerMsg) => void,
  onStatus?: (s: ConnStatus) => void,
): { send: (m: object) => void; close: () => void } {
  let ws: WebSocket
  let intentionallyClosed = false
  let retryCount = 0

  function createWs() {
    ws = new WebSocket(`${WS_BASE}/play`)

    ws.onopen = () => {
      retryCount = 0
      onStatus?.('open')
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
        // 重连次数耗尽，彻底失败
        onStatus?.('closed')
      }
    }
  }

  createWs()

  return {
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(m))
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener('open', () => ws.send(JSON.stringify(m)), { once: true })
      } else {
        // CLOSING、CLOSED 或重连中：丢弃并警告
        console.warn('[ws-client] 连接未就绪，消息已丢弃:', m)
      }
    },
    close: () => {
      intentionallyClosed = true
      ws.close()
    },
  }
}
