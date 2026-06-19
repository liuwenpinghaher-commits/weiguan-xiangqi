import { useEffect, useState } from 'react'
import { getGrowth, getWeakness, getCompare, THEME_LABEL } from '../api/http-client.js'
import { ScoreLine } from '../charts/ScoreLine.js'
import { WeaknessRadar } from '../charts/WeaknessRadar.js'

interface Metric { gameId: number; estElo: number; acpl: number; accuracy: number }
interface Weak { phase: string; theme: string; count: number; avgLoss: number }
interface Compare { summary: string; before: { games: number }; after: { games: number } }

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
    </div>
  )
}
