import type { GrowthMetric } from '../types.js'

export interface WindowStats {
  games: number
  acpl: number
  accuracy: number
  estElo: number
  blundersPerGame: number
  mistakesPerGame: number
}

export interface CompareReport {
  before: WindowStats
  after: WindowStats
  deltas: { acpl: number; accuracy: number; estElo: number; blundersPerGame: number; mistakesPerGame: number }
  summary: string
}

function aggregate(ms: GrowthMetric[]): WindowStats {
  const n = ms.length
  if (n === 0) return { games: 0, acpl: 0, accuracy: 0, estElo: 0, blundersPerGame: 0, mistakesPerGame: 0 }
  const sum = (f: (m: GrowthMetric) => number) => ms.reduce((a, m) => a + f(m), 0)
  return {
    games: n,
    acpl: Math.round(sum((m) => m.acpl) / n),
    accuracy: Math.round((sum((m) => m.accuracy) / n) * 10) / 10,
    estElo: Math.round(sum((m) => m.estElo) / n),
    blundersPerGame: Math.round((sum((m) => m.blunders) / n) * 100) / 100,
    mistakesPerGame: Math.round((sum((m) => m.mistakes) / n) * 100) / 100,
  }
}

export function compareWindows(before: GrowthMetric[], after: GrowthMetric[]): CompareReport {
  const b = aggregate(before)
  const a = aggregate(after)
  const deltas = {
    acpl: a.acpl - b.acpl,
    accuracy: Math.round((a.accuracy - b.accuracy) * 10) / 10,
    estElo: a.estElo - b.estElo,
    blundersPerGame: Math.round((a.blundersPerGame - b.blundersPerGame) * 100) / 100,
    mistakesPerGame: Math.round((a.mistakesPerGame - b.mistakesPerGame) * 100) / 100,
  }
  return { before: b, after: a, deltas, summary: summarize(b, a, deltas) }
}

function summarize(b: WindowStats, a: WindowStats, d: CompareReport['deltas']): string {
  if (b.games === 0 || a.games === 0) return '样本不足:两个时间段都需要至少一局已诊断的对局才能对比。'
  const elo = d.estElo > 0 ? `提升约 ${d.estElo} 分` : d.estElo < 0 ? `下降约 ${-d.estElo} 分` : '基本持平'
  const acpl = d.acpl < 0 ? `平均每手丢分从 ${b.acpl} 降到 ${a.acpl}(更精准)`
    : d.acpl > 0 ? `平均每手丢分从 ${b.acpl} 升到 ${a.acpl}(更毛糙)`
    : `平均每手丢分持平(${a.acpl})`
  const blunder = d.blundersPerGame < 0 ? `每局漏着减少 ${-d.blundersPerGame}`
    : d.blundersPerGame > 0 ? `每局漏着增加 ${d.blundersPerGame}` : '每局漏着持平'
  const mistake = d.mistakesPerGame < 0 ? `失误减少 ${-d.mistakesPerGame}/局`
    : d.mistakesPerGame > 0 ? `失误增加 ${d.mistakesPerGame}/局` : '失误持平'
  return `近 ${a.games} 局对比此前 ${b.games} 局:估算棋力${elo};${acpl};${blunder};${mistake}。`
}
