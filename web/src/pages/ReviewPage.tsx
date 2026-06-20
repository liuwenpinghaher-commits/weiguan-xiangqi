import { useEffect, useState } from 'react'
import { Board } from '../board/Board.js'
import { HTTP_BASE } from '../api/config.js'
import { PageShell, cardStyle, headingStyle, ErrorBanner } from '../ui/PageShell.js'

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
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    setFetchError(null)
    fetch(`${HTTP_BASE}/games/${props.gameId}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then(d => {
        setMoves(d.moves)
        setStartFen(d.game.startFen)
        setMsgs(d.messages ?? [])
      })
      .catch((e: Error) => {
        setFetchError('加载失败，请确认后端在运行（' + e.message + '）')
      })
      .finally(() => setLoading(false))
  }, [props.gameId])

  const fen = idx === 0 ? startFen : moves[idx - 1]?.fenAfter ?? startFen

  return (
    <PageShell>
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        {/* 标题行 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
          <h1 style={{ ...headingStyle, fontSize: '1.5rem', margin: 0, flex: 1 }}>
            复盘 · 第 {props.gameId} 局
          </h1>
          <button
            onClick={() => downloadGameExport(props.gameId)}
            style={exportBtnStyle}
            title="导出本局棋谱 JSON"
            aria-label="导出本局棋谱 JSON"
          >
            导出棋谱
          </button>
        </div>

        {/* 快速导航到分析/训练 */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
          <a href={`#/analysis/${props.gameId}`} style={analysisBtnStyle} aria-label={`诊断第${props.gameId}局`}>
            去诊断本局
          </a>
          <a href={`#/training/${props.gameId}`} style={trainingBtnStyle} aria-label={`训练第${props.gameId}局失误`}>
            针对训练
          </a>
        </div>

        {fetchError && <ErrorBanner msg={fetchError} />}

        {loading && !fetchError && (
          <p style={{ color: '#aaa' }}>加载中…</p>
        )}

        {!loading && !fetchError && startFen && (
          <>
            <div style={cardStyle}>
              <Board fen={fen} onMove={() => {}} />
              <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
                <button
                  onClick={() => setIdx(i => Math.max(0, i - 1))}
                  disabled={idx === 0}
                  aria-label="上一手"
                  style={navBtnStyle}
                >
                  上一手
                </button>
                <span style={{ color: '#aaa', fontSize: '0.9rem' }}>{idx} / {moves.length}</span>
                <button
                  onClick={() => setIdx(i => Math.min(moves.length, i + 1))}
                  disabled={idx === moves.length}
                  aria-label="下一手"
                  style={navBtnStyle}
                >
                  下一手
                </button>
              </div>
            </div>

            {msgs.length > 0 && (
              <div style={cardStyle}>
                <h2 style={{ ...headingStyle, fontSize: '1rem', margin: '0 0 10px' }}>观众席回放</h2>
                <div style={msgListStyle}>
                  {msgs.map(m => (
                    <div key={m.id} style={{ padding: '5px 12px', fontSize: 13, lineHeight: '1.5' }}>
                      <span style={{ color: '#666', marginRight: 8, fontSize: 11 }}>
                        {m.ts.replace('T', ' ').slice(0, 19)}
                      </span>
                      <span style={{ fontWeight: 600, marginRight: 6, color: '#f5c518' }}>
                        {personaName(m.personaId)}
                      </span>
                      <span style={{ color: '#ccc' }}>{m.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </PageShell>
  )
}

const exportBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: '5px 12px',
  cursor: 'pointer',
  background: 'rgba(255,255,255,0.1)',
  color: '#ccc',
  border: '1px solid rgba(255,255,255,0.2)',
  borderRadius: 6,
}

const analysisBtnStyle: React.CSSProperties = {
  padding: '6px 16px',
  background: '#2980b9',
  color: '#fff',
  borderRadius: 6,
  textDecoration: 'none',
  fontSize: '0.85rem',
  fontWeight: 600,
}

const trainingBtnStyle: React.CSSProperties = {
  padding: '6px 16px',
  background: '#27ae60',
  color: '#fff',
  borderRadius: 6,
  textDecoration: 'none',
  fontSize: '0.85rem',
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

const msgListStyle: React.CSSProperties = {
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 8,
  maxHeight: 320,
  overflowY: 'auto',
  padding: '4px 0',
  background: 'rgba(0,0,0,0.2)',
}
