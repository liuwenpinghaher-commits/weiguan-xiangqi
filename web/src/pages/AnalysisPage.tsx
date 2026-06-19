import { useEffect, useState } from 'react'
import { diagnoseGame, getDiagnosis, THEME_LABEL } from '../api/http-client.js'
import { ScoreLine } from '../charts/ScoreLine.js'

interface Annotation { ply: number; side: string; cpLoss: number; bestMove: string; phase: string; theme: string }
interface MoveRow { ply: number; move: string; byAi: boolean }

export function AnalysisPage({ gameId }: { gameId: number }) {
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [ann, setAnn] = useState<Annotation[]>([])
  const [humanSide, setHumanSide] = useState<string>('red')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')

  async function load() {
    const d = await getDiagnosis(gameId)
    setMoves(d.moves); setAnn(d.annotations); setHumanSide(d.game.humanSide)
    setStatus(d.annotations.length ? '' : '本局尚未诊断,点上方按钮开始')
  }
  useEffect(() => { load().catch((e) => setStatus('加载失败:' + e.message)) }, [gameId])

  async function run() {
    setBusy(true); setStatus('诊断中(引擎逐手分析,可能数十秒)…')
    try { await diagnoseGame(gameId); await load(); setStatus('诊断完成') }
    catch (e) { setStatus('诊断失败:' + (e as Error).message) }
    finally { setBusy(false) }
  }

  const points = ann.filter((a) => a.side === humanSide).map((a) => ({ ply: a.ply, cp: a.cpLoss }))
  const moveOf = (ply: number) => moves.find((m) => m.ply === ply)?.move ?? ''

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>第 {gameId} 局 · 诊断</h1>
      <button onClick={run} disabled={busy}>{busy ? '诊断中…' : '诊断本局'}</button>
      <p>{status}</p>
      <ScoreLine points={points} />
      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 12 }}>
        <thead><tr><th>手</th><th>方</th><th>着法</th><th>丢分</th><th>判定</th><th>最佳着</th></tr></thead>
        <tbody>
          {ann.map((a) => (
            <tr key={a.ply} style={{ background: a.theme !== 'ok' && a.side === humanSide ? '#fff3f3' : undefined }}>
              <td>{a.ply}</td><td>{a.side === 'red' ? '红' : '黑'}</td><td>{moveOf(a.ply)}</td>
              <td>{a.cpLoss}</td><td>{THEME_LABEL[a.theme] ?? a.theme}</td><td>{a.bestMove}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
