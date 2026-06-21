import { useEffect, useState } from 'react'
import { Board } from '../board/Board.js'
import { HTTP_BASE } from '../api/config.js'
import { PageShell, cardStyle, headingStyle, ErrorBanner } from '../ui/PageShell.js'
import { color, radius, space, fontSize, btn } from '../ui/theme.js'

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
        <div style={{ display: 'flex', alignItems: 'center', gap: space.md, marginBottom: space.lg, flexWrap: 'wrap' }}>
          <h1 style={{ ...headingStyle, fontSize: fontSize.xl, margin: 0, flex: 1 }}>
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
        <div style={{ display: 'flex', gap: space.sm + 2, marginBottom: space.lg, flexWrap: 'wrap' }}>
          <a href={`#/analysis/${props.gameId}`} style={analysisBtnStyle} aria-label={`诊断第${props.gameId}局`}>
            去诊断本局
          </a>
          <a href={`#/training/${props.gameId}`} style={trainingBtnStyle} aria-label={`训练第${props.gameId}局失误`}>
            针对训练
          </a>
        </div>

        {fetchError && <ErrorBanner msg={fetchError} />}

        {loading && !fetchError && (
          <p style={{ color: color.textMuted }}>加载中…</p>
        )}

        {!loading && !fetchError && startFen && (
          <>
            <div style={cardStyle}>
              <Board fen={fen} onMove={() => {}} />
              <div style={{ marginTop: space.md, display: 'flex', alignItems: 'center', gap: space.md }}>
                <button
                  onClick={() => setIdx(i => Math.max(0, i - 1))}
                  disabled={idx === 0}
                  aria-label="上一手"
                  style={navBtnStyle}
                >
                  上一手
                </button>
                <span style={{ color: color.textMuted, fontSize: fontSize.base }}>{idx} / {moves.length}</span>
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
                <h2 style={{ ...headingStyle, fontSize: fontSize.md, margin: `0 0 ${space.sm + 2}px` }}>观众席回放</h2>
                <div style={msgListStyle}>
                  {msgs.map(m => (
                    <div key={m.id} style={{ padding: `${space.xs + 1}px ${space.md}px`, fontSize: 13, lineHeight: '1.5' }}>
                      <span style={{ color: color.textFaint, marginRight: space.sm, fontSize: 11 }}>
                        {m.ts.replace('T', ' ').slice(0, 19)}
                      </span>
                      <span style={{ fontWeight: 600, marginRight: 6, color: color.gold }}>
                        {personaName(m.personaId)}
                      </span>
                      <span style={{ color: color.text }}>{m.text}</span>
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
  ...btn('secondary', { size: 'sm' }),
}

const analysisBtnStyle: React.CSSProperties = {
  ...btn('info'),
  textDecoration: 'none',
  display: 'inline-block',
}

const trainingBtnStyle: React.CSSProperties = {
  ...btn('success'),
  textDecoration: 'none',
  display: 'inline-block',
}

const navBtnStyle: React.CSSProperties = {
  ...btn('secondary'),
}

const msgListStyle: React.CSSProperties = {
  border: `1px solid ${color.border}`,
  borderRadius: radius.md,
  maxHeight: 320,
  overflowY: 'auto',
  padding: `${space.xs}px 0`,
  background: color.surfaceAlt,
}
