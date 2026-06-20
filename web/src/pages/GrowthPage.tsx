import { useEffect, useState } from 'react'
import { getGrowth, getWeakness, getCompare, THEME_LABEL } from '../api/http-client.js'
import { ScoreLine } from '../charts/ScoreLine.js'
import { WeaknessRadar } from '../charts/WeaknessRadar.js'

interface Metric { gameId: number; estElo: number; acpl: number; accuracy: number }
interface Weak { phase: string; theme: string; count: number; avgLoss: number }
interface Compare { summary: string; before: { games: number }; after: { games: number } }

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: '0.88rem',
  marginTop: 8,
}
const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '1px solid #444',
  color: '#aaa',
  fontWeight: 600,
}
const trStyle: React.CSSProperties = {
  borderBottom: '1px solid #2a2a3e',
}
const tdStyle: React.CSSProperties = {
  padding: '7px 10px',
  color: '#ddd',
}
const aAnalysisStyle: React.CSSProperties = {
  padding: '3px 10px',
  background: '#2980b9',
  color: '#fff',
  borderRadius: 4,
  textDecoration: 'none',
  fontSize: '0.82rem',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}
const aTrainingStyle: React.CSSProperties = {
  padding: '3px 10px',
  background: '#27ae60',
  color: '#fff',
  borderRadius: 4,
  textDecoration: 'none',
  fontSize: '0.82rem',
  fontWeight: 600,
  whiteSpace: 'nowrap',
}

export function GrowthPage({ side = 'red' as 'red' | 'black' }) {
  const [metrics, setMetrics] = useState<Metric[]>([])
  const [weak, setWeak] = useState<Weak[]>([])
  const [cmp, setCmp] = useState<Compare | null>(null)

  useEffect(() => {
    getGrowth().then((d) => setMetrics(d.metrics)).catch(() => {})
    getWeakness(side).then((d) => setWeak(d.profile)).catch(() => {})
    getCompare().then(setCmp).catch(() => {})
  }, [side])

  const eloPoints = metrics.map((m) => ({ ply: m.gameId, cp: m.estElo }))
  const radar = weak.map((w) => ({ axis: `${w.phase}·${THEME_LABEL[w.theme] ?? w.theme}`, value: w.count }))

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: 16 }}>
      <h1>成长轨迹（{side === 'red' ? '红方' : '黑方'}）</h1>
      <h2>估算棋力曲线（{metrics.length} 局）</h2>
      <ScoreLine points={eloPoints} />
      <h2>弱点画像</h2>
      {radar.length ? <WeaknessRadar data={radar} /> : <p>暂无失误样本(下几局并诊断后出现)。</p>}
      <h2>历史对比</h2>
      <p>{cmp?.summary ?? '加载中…'}</p>

      {metrics.length > 0 && (
        <>
          <h2>按局查看</h2>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={thStyle}>局次</th>
                <th style={thStyle}>估算棋力</th>
                <th style={thStyle}>ACPL</th>
                <th style={thStyle}>准确率</th>
                <th style={thStyle}>操作</th>
              </tr>
            </thead>
            <tbody>
              {metrics.map((m) => (
                <tr key={m.gameId} style={trStyle}>
                  <td style={tdStyle}>#{m.gameId}</td>
                  <td style={tdStyle}>{m.estElo}</td>
                  <td style={tdStyle}>{m.acpl}</td>
                  <td style={tdStyle}>{(m.accuracy * 100).toFixed(1)}%</td>
                  <td style={{ ...tdStyle, display: 'flex', gap: 8 }}>
                    <a href={`#/analysis/${m.gameId}`} style={aAnalysisStyle}>分析本局</a>
                    <a href={`#/training/${m.gameId}`} style={aTrainingStyle}>针对训练</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
