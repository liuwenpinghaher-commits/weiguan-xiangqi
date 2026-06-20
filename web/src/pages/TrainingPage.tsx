import { useEffect, useState } from 'react'
import { getDrills, postDrillAttempt, THEME_LABEL } from '../api/http-client.js'
import { Board } from '../board/Board.js'
import { PageShell, cardStyle, headingStyle, ErrorBanner } from '../ui/PageShell.js'

interface Drill { ply: number; fen: string; bestMove: string; playedMove: string; cpLoss: number; theme: string }
interface Stats { total: number; correct: number }

export function TrainingPage({ gameId }: { gameId: number }) {
  const [drills, setDrills] = useState<Drill[]>([])
  const [i, setI] = useState(0)
  const [feedback, setFeedback] = useState('')
  const [stats, setStats] = useState<Stats | null>(null)
  const [answering, setAnswering] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    getDrills(gameId)
      .then((d: { drills: Drill[]; stats?: Stats }) => {
        setDrills(d.drills)
        setI(0)
        setFeedback('')
        if (d.stats) setStats(d.stats)
      })
      .catch((e: Error) => {
        setFetchError('加载失败，请确认后端在运行（' + e.message + '）')
      })
      .finally(() => setLoading(false))
  }, [gameId])

  async function answer(move: string) {
    if (answering) return
    setAnswering(true)
    try {
      const result = await postDrillAttempt(gameId, drills[i].ply, move)
      if (result.correct) {
        setFeedback(`✓ 正解！就是这手 ${move}。`)
      } else {
        setFeedback(`✗ 你走了 ${move}；引擎最佳是 ${drills[i].bestMove}（原局你当时走的是 ${drills[i].playedMove}）`)
      }
      setStats(result.stats)
    } catch {
      // 后端不可达时退回前端比对
      setFeedback(move === drills[i].bestMove
        ? `✓ 正解！就是这手 ${move}。`
        : `✗ 你走了 ${move}；引擎最佳是 ${drills[i].bestMove}（原局你当时走的是 ${drills[i].playedMove}）`)
    } finally {
      setAnswering(false)
    }
  }

  const accuracy = stats && stats.total > 0
    ? Math.round((stats.correct / stats.total) * 100)
    : null

  const d = drills[i]

  return (
    <PageShell>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <h1 style={{ ...headingStyle, fontSize: '1.6rem', marginBottom: 16 }}>
          训练 · 第 {gameId} 局失误复盘
        </h1>

        {fetchError && <ErrorBanner msg={fetchError} />}

        {loading && !fetchError && (
          <p style={{ color: '#aaa' }}>加载中…</p>
        )}

        {!loading && !fetchError && drills.length === 0 && (
          <div style={{ ...cardStyle, color: '#aaa' }}>
            本局暂无可练的失误题（需先诊断）。
          </div>
        )}

        {!loading && drills.length > 0 && d && (
          <>
            {stats && (
              <div style={statsBannerStyle}>
                本局训练：正确 {stats.correct} / 共 {stats.total}
                {accuracy !== null && <>（正确率 {accuracy}%）</>}
              </div>
            )}

            <div style={cardStyle}>
              <p style={{ margin: '0 0 12px', color: '#ccc' }}>
                第 {i + 1}/{drills.length} 题 · 原判定：{THEME_LABEL[d.theme] ?? d.theme}（丢 {d.cpLoss} 分）。
                轮到你，走出最佳着：
              </p>

              <Board fen={d.fen} onMove={answer} />

              <p style={{
                minHeight: 24,
                marginTop: 12,
                marginBottom: 0,
                color: feedback.startsWith('✓') ? '#8bc34a' : feedback.startsWith('✗') ? '#e74c3c' : '#aaa',
              }}
                aria-live="polite"
              >
                {feedback}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4 }}>
              <button
                onClick={() => { setI((x) => Math.max(0, x - 1)); setFeedback('') }}
                disabled={i === 0}
                aria-label="上一题"
                style={navBtnStyle}
              >
                上一题
              </button>
              <span style={{ color: '#aaa', fontSize: '0.9rem' }}>{i + 1} / {drills.length}</span>
              <button
                onClick={() => { setI((x) => Math.min(drills.length - 1, x + 1)); setFeedback('') }}
                disabled={i === drills.length - 1}
                aria-label="下一题"
                style={navBtnStyle}
              >
                下一题
              </button>
            </div>
          </>
        )}
      </div>
    </PageShell>
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

const navBtnStyle: React.CSSProperties = {
  padding: '7px 18px',
  background: 'rgba(255,255,255,0.1)',
  color: '#ccc',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: '0.9rem',
}
