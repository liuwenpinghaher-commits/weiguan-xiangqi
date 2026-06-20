import { test, expect } from 'vitest'
import { pickSpeakers } from './speaker-select.js'
import { spectators } from '../personas/personas.js'
import type { Stimulus } from '../types.js'

const base: Stimulus = { kind: 'move', gameId: 1, scoreCp: 30, tension: 0.5 }

test('低张力 + 大家刚说过 → 可能无人发言(避免刷屏)', () => {
  const recent = new Map(spectators().map(p => [p.id, 0])) // 全部 0 秒前刚说
  const picks = pickSpeakers({ ...base, tension: 0.05 }, spectators(), recent, () => 0.0)
  expect(picks.length).toBeLessThanOrEqual(1)
})

test('高张力(妙手/漏着)→ 至少一人发言', () => {
  const recent = new Map<string, number>() // 都没说过
  const picks = pickSpeakers({ ...base, kind: 'blunder', tension: 0.95 }, spectators(), recent, () => 0.9)
  expect(picks.length).toBeGreaterThanOrEqual(1)
})

test('最近刚发言的人被惩罚,不容易连续刷屏', () => {
  const recent = new Map<string, number>([['netizen', 0]]) // 阿强刚说过
  const picks = pickSpeakers({ ...base, tension: 0.9 }, spectators(), recent, () => 0.5)
  // 阿强即便分高也因惩罚靠后;不应是唯一且必然
  expect(picks).not.toEqual(['netizen'])
})

test('一次最多 2 人发言(不全员刷屏)', () => {
  const recent = new Map<string, number>()
  const picks = pickSpeakers({ ...base, tension: 1 }, spectators(), recent, () => 0.99)
  expect(picks.length).toBeLessThanOrEqual(2)
})
