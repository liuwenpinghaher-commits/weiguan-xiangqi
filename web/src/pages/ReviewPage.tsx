import { useEffect, useState } from 'react'
import { Board } from '../board/Board.js'
import { HTTP_BASE } from '../api/config.js'

/** 下载单局棋谱 JSON */
function downloadGameExport(gameId: number) {
  const a = document.createElement('a')
  a.href = `${HTTP_BASE}/games/${gameId}/export`
  a.download = `game-${gameId}.json`
  a.click()
}

interface MoveRow { ply: number; move: string; fenAfter: string; byAi: boolean; scoreCp: number | null }
interface MessageRow { id: number; personaId: string; role: string; text: string; addressee: string | null; ts: string }

const PERSONA_NAMES: Record<string, string> = {
  player: '老黑',
  laopaoer: '炮儿爷',
  coach: '林教练',
  netizen: '吃瓜阿强',
  human: '你',
}

function personaName(personaId: string): string {
  return PERSONA_NAMES[personaId] ?? personaId
}

export function ReviewPage(props: { gameId: number }) {
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [startFen, setStartFen] = useState('')
  const [msgs, setMsgs] = useState<MessageRow[]>([])
  const [idx, setIdx] = useState(0) // 0=开局,k=第k手后

  useEffect(() => {
    fetch(`${HTTP_BASE}/games/${props.gameId}`).then(r => r.json()).then(d => {
      setMoves(d.moves)
      setStartFen(d.game.startFen)
      setMsgs(d.messages ?? [])
    })
  }, [props.gameId])

  const fen = idx === 0 ? startFen : moves[idx - 1]?.fenAfter ?? startFen

  if (!startFen) {
    return (
      <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
        <h1>复盘 · 第 {props.gameId} 局</h1>
        <p>加载中…</p>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0, flex: 1 }}>复盘 · 第 {props.gameId} 局</h1>
        <button
          onClick={() => downloadGameExport(props.gameId)}
          style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer' }}
          title="导出本局棋谱 JSON"
        >
          导出棋谱
        </button>
      </div>
      <Board fen={fen} onMove={() => {}} />
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>上一手</button>
        <span style={{ margin: '0 12px' }}>{idx} / {moves.length}</span>
        <button onClick={() => setIdx(i => Math.min(moves.length, i + 1))} disabled={idx === moves.length}>下一手</button>
      </div>

      {msgs.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2 style={{ fontSize: 15, marginBottom: 8, color: '#555' }}>观众席回放</h2>
          <div style={{
            border: '1px solid #e0e0e0',
            borderRadius: 8,
            maxHeight: 320,
            overflowY: 'auto',
            padding: '8px 0',
            background: '#fafafa',
          }}>
            {msgs.map(m => (
              <div key={m.id} style={{ padding: '5px 12px', fontSize: 13, lineHeight: '1.5' }}>
                <span style={{ color: '#999', marginRight: 8, fontSize: 11 }}>
                  {m.ts.replace('T', ' ').slice(0, 19)}
                </span>
                <span style={{ fontWeight: 600, marginRight: 6 }}>
                  {personaName(m.personaId)}
                </span>
                <span style={{ color: '#333' }}>{m.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
