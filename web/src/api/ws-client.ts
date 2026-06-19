export type ServerMsg =
  | { type: 'started'; gameId: number }
  | { type: 'update'; aiMove: string | null; fen: string; over: boolean }
  | { type: 'error'; message: string }

export function connect(
  onMsg: (m: ServerMsg) => void,
): { send: (m: object) => void; close: () => void } {
  const ws = new WebSocket('ws://localhost:8787/play')
  ws.onmessage = (e) => onMsg(JSON.parse(e.data) as ServerMsg)
  return {
    send: (m) =>
      ws.readyState === 1
        ? ws.send(JSON.stringify(m))
        : ws.addEventListener('open', () => ws.send(JSON.stringify(m)), { once: true }),
    close: () => ws.close(),
  }
}
