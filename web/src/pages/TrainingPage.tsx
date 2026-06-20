import { useEffect, useState } from 'react'
import { getDrills, postDrillAttempt, THEME_LABEL } from '../api/http-client.js'
import { Board } from '../board/Board.js'

interface Drill { ply: number; fen: string; bestMove: string; playedMove: string; cpLoss: number; theme: string }
interface Stats { total: number; correct: number }

export function TrainingPage({ gameId }: { gameId: number }) {
  const [drills, setDrills] = useState<Drill[]>([])
  const [i, setI] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [answering, setAnswering] = useState(false)

  useEffect(() => {
    getDrills(gameId)
      .then((d: { drills: Drill[]; stats?: Stats }) => {
        setDrills(d.drills)
        setI(0)
        setFeedback('')
        if (d.stats) setStats(d.stats)
      })
      .catch(() => {})
  }, [gameId])

  if (drills.length === 0) return <div style={{ padding: 16 }}>本局暂无可练的失误题(需先诊断)。</div>
  const d = drills[i]

  async function answer(move: string) {
    if (answering) return
    setAnswering(true)
    try {
      const result = await postDrillAttempt(gameId, d.ply, move)
      if (result.correct) {
        setFeedback(`✓ 正解！就是这手 ${move}。`)
      } else {
        setFeedback(`✗ 你走了 ${move}；引擎最佳是 ${d.bestMove}（原局你当时走的是 ${d.playedMove}）`)
      }
      setStats(result.stats)
    } catch {
      // 后端不可达时退回前端比对
      setFeedback(move === d.bestMove
        ? `✓ 正解！就是这手 ${move}。`
        : `✗ 你走了 ${move}；引擎最佳是 ${d.bestMove}（原局你当时走的是 ${d.playedMove}）`)
    } finally {
      setAnswering(false)
    }
  }

  const accuracy = stats && stats.total > 0
    ? Math.round((stats.correct / stats.total) * 100)
    : null

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <h1>训练 · 第 {gameId} 局失误复盘</h1>

      {stats ? (
        <div style={statsBannerStyle}>
          本局训练：正确 {stats.correct} / 共 {stats.total}
          {accuracy !== null && <>（正确率 {accuracy}%）</>}
        </div>
      ) : null}

      <p>
        第 {i + 1}/{drills.length} 题 · 原判定：{THEME_LABEL[d.theme] ?? d.theme}（丢 {d.cpLoss} 分）。
        轮到你，走出最佳着：
      </p>

      <Board fen={d.fen} onMove={answer} />

      <p style={{ minHeight: 24, color: feedback.startsWith('✓') ? '#8bc34a' : feedback.startsWith('✗') ? '#e74c3c' : undefined }}>
        {feedback}
      </p>

      <button
        onClick={() => { setI((x) => Math.max(0, x - 1)); setFeedback('') }}
        disabled={i === 0}
      >
        上一题
      </button>
      <span style={{ margin: '0 12px' }}>{i + 1} / {drills.length}</span>
      <button
        onClick={() => { setI((x) => Math.min(drills.length - 1, x + 1)); setFeedback('') }}
        disabled={i === drills.length - 1}
      >
        下一题
      </button>
    </div>
  )
}

const statsBannerStyle: React.CSSProperties = {
  background: 'rgba(245,197,24,0.12)',
  border: '1px solid rgba(245,197,24,0.35)',
  borderRadius: 6,
  padding: '8px 14px',
  marginBottom: 12,
  fontSize: '0.9rem',
  color: '#f5c518',
  fontWeight: 600,
}
