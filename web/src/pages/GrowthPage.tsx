import { useEffect, useState } from 'react'
import { getGrowth, getWeakness, getCompare, getSparring, THEME_LABEL } from '../api/http-client.js'
import { ScoreLine } from '../charts/ScoreLine.js'
import { WeaknessRadar } from '../charts/WeaknessRadar.js'
import { PageShell, cardStyle, headingStyle, darkThStyle, darkTrStyle, darkTdStyle, ErrorBanner } from '../ui/PageShell.js'
import { color, radius, fontSize, btn } from '../ui/theme.js'

interface Metric { gameId: number; estElo: number; acpl: number; accuracy: number }
interface Weak { phase: string; theme: string; count: number; avgLoss: number }
interface Compare { summary: string; report?: string; before: { games: number }; after: { games: number } }

const aAnalysisStyle: React.CSSProperties = {
  ...btn('info', { size: 'sm' }),
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}
const aTrainingStyle: React.CSSProperties = {
  ...btn('success', { size: 'sm' }),
  textDecoration: 'none',
  whiteSpace: 'nowrap',
}
const aSparringStyle: React.CSSProperties = {
  ...btn('secondary', { size: 'sm' }),
  background: 'rgba(142,68,173,0.85)',
  color: '#fff',
  borderColor: 'rgba(142,68,173,0.6)',
  whiteSpace: 'nowrap',
}

export function GrowthPage({ side = 'red' as 'red' | 'black' }) {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [weak, setWeak] = useState<Weak[]>([])
  const [cmp, setCmp] = useState<Compare | null>(null)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [cmpLoading, setCmpLoading] = useState(true)

  useEffect(() => {
    setFetchError(null)
    setCmpLoading(true)

    getGrowth()
      .then((d) => setMetrics(d.metrics))
      .catch((e: Error) => setFetchError('加载失败，请确认后端在运行（' + e.message + '）'))

    getWeakness(side)
      .then((d) => setWeak(d.profile))
      .catch(() => { /* 弱点数据失败时沉默，主错误已由 getGrowth 处理 */ })

    getCompare()
      .then((d) => { setCmp(d); setCmpLoading(false) })
      .catch(() => { setCmp(null); setCmpLoading(false) })
  }, [side])

  /** 专项陪练：拿到失误局面 FEN 写入 sessionStorage，跳回对局页 */
  async function handleSparring(gameId: number) {
    try {
      const res = await getSparring(gameId)
      if (!res.startFen) {
        alert('该局暂无失误诊断数据，请先诊断后再试。')
        return
      }
      sessionStorage.setItem('weiguan_sparring_fen', res.startFen)
      sessionStorage.setItem('weiguan_sparring_side', res.humanSide)
      location.hash = '#/'
    } catch {
      alert('获取专项陪练局面失败，请稍后重试。')
    }
  }

  const eloPoints = metrics.map((m) => ({ ply: m.gameId, cp: m.estElo }))
  const radar = weak.map((w) => ({ axis: `${w.phase}·${THEME_LABEL[w.theme] ?? w.theme}`, value: w.count }))

  // 优先展示 LLM 成长报告，降级到规则 summary
  const reportText = cmp?.report ?? cmp?.summary ?? null

  return (
    <PageShell>
      <div style={{ maxWidth: 720, margin: '0 auto' }}>
        <h1 style={{ ...headingStyle, fontSize: fontSize.xl, marginBottom: 16 }}>
          成长轨迹（{side === 'red' ? '红方' : '黑方'}）
        </h1>

        {fetchError && <ErrorBanner msg={fetchError} />}

        <div style={cardStyle}>
          <h2 style={{ ...headingStyle, fontSize: fontSize.md, marginTop: 0, marginBottom: 12 }}>
            估算棋力曲线（{metrics.length} 局）
          </h2>
          <ScoreLine points={eloPoints} />
        </div>

        <div style={cardStyle}>
          <h2 style={{ ...headingStyle, fontSize: fontSize.md, marginTop: 0, marginBottom: 12 }}>弱点画像</h2>
          {radar.length
            ? <WeaknessRadar data={radar} />
            : <p style={{ color: color.textFaint, margin: 0 }}>暂无失误样本（下几局并诊断后出现）。</p>
          }
        </div>

        <div style={cardStyle}>
          <h2 style={{ ...headingStyle, fontSize: fontSize.md, marginTop: 0, marginBottom: 8 }}>成长点评</h2>
          <p style={{ color: color.textMuted, margin: 0, lineHeight: 1.7 }}>
            {cmpLoading
              ? '加载中…'
              : reportText
              ? reportText
              : '暂无历史对比数据'}
          </p>
        </div>

        {metrics.length > 0 && (
          <div style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
            <h2 style={{ ...headingStyle, fontSize: fontSize.md, margin: 0, padding: '14px 16px', borderBottom: `1px solid ${color.border}` }}>
              按局查看
            </h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.base }}>
              <thead>
                <tr>
                  <th style={darkThStyle}>局次</th>
                  <th style={darkThStyle}>估算棋力</th>
                  <th style={darkThStyle}>ACPL</th>
                  <th style={darkThStyle}>准确率</th>
                  <th style={darkThStyle}>操作</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((m) => (
                  <tr key={m.gameId} style={darkTrStyle}>
                    <td style={darkTdStyle}>#{m.gameId}</td>
                    <td style={darkTdStyle}>{m.estElo}</td>
                    <td style={darkTdStyle}>{m.acpl}</td>
                    <td style={darkTdStyle}>{(m.accuracy * 100).toFixed(1)}%</td>
                    <td style={{ ...darkTdStyle, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <a href={`#/analysis/${m.gameId}`} style={aAnalysisStyle} aria-label={`分析第${m.gameId}局`}>
                        分析本局
                      </a>
                      <a href={`#/training/${m.gameId}`} style={aTrainingStyle} aria-label={`针对训练第${m.gameId}局`}>
                        针对训练
                      </a>
                      <button
                        style={aSparringStyle}
                        aria-label={`专项陪练第${m.gameId}局`}
                        onClick={() => handleSparring(m.gameId)}
                      >
                        专项陪练
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageShell>
  )
}
