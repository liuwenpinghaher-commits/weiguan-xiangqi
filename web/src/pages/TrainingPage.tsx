import { useEffect, useState } from 'react'
import { getDrills, THEME_LABEL } from '../api/http-client.js'
import { Board } from '../board/Board.js'

interface Drill { ply: number; fen: string; bestMove: string; playedMove: string; cpLoss: number; theme: string }

export function TrainingPage({ gameId }: { gameId: number }) {
  const [drills, setDrills] = useState<Drill[]>([])
  const [i, setI] = useState(0)
  const [feedback, setFeedback] = useState('')

  useEffect(() => {
    getDrills(gameId).then((d) => { setDrills(d.drills); setI(0); setFeedback('') }).catch(() => {})
  }, [gameId])

  if (drills.length === 0) return <div style={{ padding: 16 }}>本局暂无可练的失误题(需先诊断)。</div>
  const d = drills[i]

  function answer(move: string) {
    setFeedback(move === d.bestMove
      ? '✓ 正解!就是这手。'
      : `✗ 你走了 ${move};引擎最佳是 ${d.bestMove}(原局你当时走的是 ${d.playedMove})`)
  }

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <h1>训练 · 第 {gameId} 局失误复盘</h1>
      <p>第 {i + 1}/{drills.length} 题 · 原判定:{THEME_LABEL[d.theme] ?? d.theme}(丢 {d.cpLoss} 分)。轮到你,走出最佳着:</p>
      <Board fen={d.fen} onMove={answer} />
      <p style={{ minHeight: 24 }}>{feedback}</p>
      <button onClick={() => { setI((x) => Math.max(0, x - 1)); setFeedback('') }} disabled={i === 0}>上一题</button>
      <span style={{ margin: '0 12px' }}>{i + 1} / {drills.length}</span>
      <button onClick={() => { setI((x) => Math.min(drills.length - 1, x + 1)); setFeedback('') }} disabled={i === drills.length - 1}>下一题</button>
    </div>
  )
}
