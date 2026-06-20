import { useEffect, useState } from 'react'
import { Board } from '../board/Board.js'
import { HTTP_BASE } from '../api/config.js'

interface MoveRow { ply: number; move: string; fenAfter: string; byAi: boolean; scoreCp: number | null }

export function ReviewPage(props: { gameId: number }) {
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [startFen, setStartFen] = useState('')
  const [idx, setIdx] = useState(0) // 0=开局,k=第k手后

  useEffect(() => {
    fetch(`${HTTP_BASE}/games/${props.gameId}`).then(r => r.json()).then(d => {
      setMoves(d.moves); setStartFen(d.game.startFen)
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
      <h1>复盘 · 第 {props.gameId} 局</h1>
      <Board fen={fen} onMove={() => {}} />
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>上一手</button>
        <span style={{ margin: '0 12px' }}>{idx} / {moves.length}</span>
        <button onClick={() => setIdx(i => Math.min(moves.length, i + 1))} disabled={idx === moves.length}>下一手</button>
      </div>
    </div>
  )
}
