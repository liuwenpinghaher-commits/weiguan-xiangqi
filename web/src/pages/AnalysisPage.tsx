import { useEffect, useState } from 'react'
import { diagnoseGame, getDiagnosis, THEME_LABEL } from '../api/http-client.js'
import { ScoreLine } from '../charts/ScoreLine.js'
import { PageShell, cardStyle, headingStyle, darkThStyle, darkTrStyle, darkTdStyle, ErrorBanner } from '../ui/PageShell.js'

interface Annotation { ply: number; side: string; cpLoss: number; bestMove: string; phase: string; theme: string }
interface MoveRow { ply: number; move: string; byAi: boolean }

export function AnalysisPage({ gameId }: { gameId: number }) {
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [ann, setAnn] = useState<Annotation[]>([])
  const [humanSide, setHumanSide] = useState<string>('red')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [fetchError, setFetchError] = useState<string | null>(null)

  async function load() {
    setFetchError(null)
    try {
      const d = await getDiagnosis(gameId)
      setMoves(d.moves); setAnn(d.annotations); setHumanSide(d.game.humanSide)
      setStatus(d.annotations.length ? '' : '本局尚未诊断，点上方按钮开始')
    } catch (e) {
      setFetchError('加载失败，请确认后端在运行（' + (e as Error).message + '）')
    }
  }

  useEffect(() => { load() }, [gameId])

  async function run() {
    setBusy(true); setStatus('诊断中（引擎逐手分析，可能数十秒）…')
    try { await diagnoseGame(gameId); await load(); setStatus('诊断完成') }
    catch (e) { setStatus('诊断失败：' + (e as Error).message) }
    finally { setBusy(false) }
  }

  const points = ann.filter((a) => a.side === humanSide).map((a) => ({ ply: a.ply, cp: a.cpLoss }))
  const moveOf = (ply: number) => moves.find((m) => m.ply === ply)?.move ?? ''

  return (
    <PageShell>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ ...headingStyle, fontSize: '1.6rem', marginBottom: 16 }}>
          第 {gameId} 局 · 诊断
        </h1>

        {fetchError && <ErrorBanner msg={fetchError} />}

        <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 }}>
          <button
            onClick={run}
            disabled={busy}
            aria-label={busy ? '诊断进行中' : '诊断本局'}
            style={runBtnStyle}
          >
            {busy ? '诊断中…' : '诊断本局'}
          </button>
          {status && (
            <span style={{ fontSize: '0.88rem', color: '#aaa' }} aria-live="polite">
              {status}
            </span>
          )}
        </div>

        <div style={cardStyle}>
          <ScoreLine points={points} />
        </div>

        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
            <thead>
              <tr>
                <th style={darkThStyle}>手</th>
                <th style={darkThStyle}>方</th>
                <th style={darkThStyle}>着法</th>
                <th style={darkThStyle}>丢分</th>
                <th style={darkThStyle}>判定</th>
                <th style={darkThStyle}>最佳着</th>
              </tr>
            </thead>
            <tbody>
              {ann.map((a) => (
                <tr
                  key={a.ply}
                  style={{
                    ...darkTrStyle,
                    background: a.theme !== 'ok' && a.side === humanSide
                      ? 'rgba(255,82,82,0.08)'
                      : undefined,
                  }}
                >
                  <td style={darkTdStyle}>{a.ply}</td>
                  <td style={darkTdStyle}>{a.side === 'red' ? '红' : '黑'}</td>
                  <td style={darkTdStyle}>{moveOf(a.ply)}</td>
                  <td style={darkTdStyle}>{a.cpLoss}</td>
                  <td style={darkTdStyle}>{THEME_LABEL[a.theme] ?? a.theme}</td>
                  <td style={darkTdStyle}>{a.bestMove}</td>
                </tr>
              ))}
              {ann.length === 0 && !fetchError && (
                <tr>
                  <td colSpan={6} style={{ ...darkTdStyle, textAlign: 'center', color: '#666', padding: '20px 0' }}>
                    暂无数据，请先诊断本局
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  )
}

const runBtnStyle: React.CSSProperties = {
  padding: '8px 20px',
  background: '#2980b9',
  color: '#fff',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontWeight: 600,
  fontSize: '0.9rem',
}
