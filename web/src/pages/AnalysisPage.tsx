import { useEffect, useState } from 'react'
import { diagnoseGame, getDiagnosis, THEME_LABEL } from '../api/http-client.js'
import { ScoreLine } from '../charts/ScoreLine.js'
import { PageShell, cardStyle, headingStyle, darkThStyle, darkTrStyle, darkTdStyle, ErrorBanner } from '../ui/PageShell.js'
import { color, fontSize, space, btn } from '../ui/theme.js'

interface Annotation { ply: number; side: string; cpLoss: number; bestMove: string; phase: string; theme: string }
interface MoveRow { ply: number; move: string; byAi: boolean }
interface DiagnosisStatus { status: 'pending' | 'running' | 'ok' | 'failed'; error?: string }

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
      const diagnosisStatus = d.diagnosisStatus as DiagnosisStatus | undefined
      if (diagnosisStatus?.status === 'failed') {
        setStatus('诊断失败：' + (diagnosisStatus.error ?? '请手动重试'))
      } else if (diagnosisStatus?.status === 'running') {
        setStatus('诊断中（可稍后刷新）')
      } else if (diagnosisStatus?.status === 'ok') {
        setStatus('')
      } else {
        setStatus('本局尚未诊断，点上方按钮开始')
      }
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
        <h1 style={{ ...headingStyle, fontSize: fontSize.xl, marginBottom: space.lg }}>
          第 {gameId} 局 · 诊断
        </h1>

        {fetchError && <ErrorBanner msg={fetchError} />}

        <div style={{ display: 'flex', gap: space.md, alignItems: 'center', marginBottom: space.md }}>
          <button
            onClick={run}
            disabled={busy}
            aria-label={busy ? '诊断进行中' : '诊断本局'}
            style={runBtnStyle}
          >
            {busy ? '诊断中…' : '诊断本局'}
          </button>
          {status && (
            <span style={{ fontSize: fontSize.base, color: color.textMuted }} aria-live="polite">
              {status}
            </span>
          )}
        </div>

        <div style={cardStyle}>
          <ScoreLine points={points} />
        </div>

        <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.base }}>
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
                      ? color.dangerSoft
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
                  <td colSpan={6} style={{ ...darkTdStyle, textAlign: 'center', color: color.textFaint, padding: `${space.xl}px 0` }}>
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
  ...btn('info'),
}
