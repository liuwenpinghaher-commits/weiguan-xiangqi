// 选型: recharts 3.8.1 (RadarChart)
// 注: data < 3 项时退化为简单条形列表，避免三角形难看
import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
  Tooltip,
} from 'recharts'

export interface WeaknessRadarProps {
  data: { axis: string; value: number }[]
}

export function WeaknessRadar({ data }: WeaknessRadarProps): JSX.Element {
  if (data.length === 0) {
    return <p style={{ color: '#888', margin: '12px 0' }}>暂无数据</p>
  }

  // < 3 项时雷达图无意义，改用简单条形
  if (data.length < 3) {
    return (
      <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0' }}>
        {data.map((d) => (
          <li key={d.axis} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <span style={{ minWidth: 120 }}>{d.axis}</span>
            <div
              style={{
                height: 16,
                width: Math.min(d.value * 12, 240),
                background: '#e63946',
                borderRadius: 3,
              }}
            />
            <span>{d.value}</span>
          </li>
        ))}
      </ul>
    )
  }

  // 将 axis/value 映射为 recharts 期望的键名
  const chartData = data.map((d) => ({ subject: d.axis, value: d.value }))
  const maxVal = Math.max(...data.map((d) => d.value), 1)

  return (
    <ResponsiveContainer width="100%" height={300}>
      <RadarChart data={chartData} margin={{ top: 16, right: 32, left: 32, bottom: 16 }}>
        <PolarGrid />
        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 11 }} />
        <PolarRadiusAxis angle={30} domain={[0, maxVal]} tick={{ fontSize: 10 }} />
        <Tooltip formatter={(v: number) => [v, '次']} />
        <Radar
          name="失误次数"
          dataKey="value"
          stroke="#e63946"
          fill="#e63946"
          fillOpacity={0.35}
          isAnimationActive={false}
        />
      </RadarChart>
    </ResponsiveContainer>
  )
}
