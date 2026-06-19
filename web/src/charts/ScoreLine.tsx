// 选型: recharts 3.8.1 (LineChart)
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'

export interface ScoreLineProps {
  points: { ply: number; cp: number }[]
}

export function ScoreLine({ points }: ScoreLineProps): JSX.Element {
  if (points.length === 0) {
    return <p style={{ color: '#888', margin: '12px 0' }}>暂无数据</p>
  }

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={points} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="ply" label={{ value: '手', position: 'insideBottomRight', offset: -4 }} />
        <YAxis />
        <Tooltip formatter={(v: number) => [v, '分']} labelFormatter={(l) => `第 ${l} 手`} />
        <Line
          type="monotone"
          dataKey="cp"
          stroke="#e63946"
          dot={points.length <= 30}
          isAnimationActive={false}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}
