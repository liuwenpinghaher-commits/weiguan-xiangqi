export type ServerMsg =
  | { type: 'started'; gameId: number }
  | { type: 'update'; aiMove: string | null; fen: string; over: boolean }
  | { type: 'error'; message: string }

export type ConnStatus = 'open' | 'closed' | 'error'

export function connect(
  onMsg: (m: ServerMsg) => void,
  onStatus?: (s: ConnStatus) => void,
): { send: (m: object) => void; close: () => void } {
  const ws = new WebSocket('ws://localhost:8787/play')

  ws.onopen = () => onStatus?.('open')

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

  ws.onerror = () => onStatus?.('error')

  ws.onclose = () => onStatus?.('closed')

  return {
    send: (m) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(m))
      } else if (ws.readyState === WebSocket.CONNECTING) {
        ws.addEventListener('open', () => ws.send(JSON.stringify(m)), { once: true })
      } else {
        // CLOSING 或 CLOSED
        console.warn('[ws-client] 连接已关闭，无法发送消息:', m)
      }
    },
    close: () => ws.close(),
  }
}
