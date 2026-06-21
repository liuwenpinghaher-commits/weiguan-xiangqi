import { test, describe, it, expect } from 'vitest'
import { pickSpeakers } from './speaker-select.js'
import { spectators } from '../personas/personas.js'
import type { Persona, Stimulus } from '../types.js'

const base: Stimulus = { kind: 'move', gameId: 1, scoreCp: 30, tension: 0.5 }

test('低张力 + 大家刚说过 → 可能无人发言(避免刷屏)', () => {
  const recent = new Map(spectators().map(p => [p.id, 0])) // 全部 0 秒前刚说
  const picks = pickSpeakers({ ...base, tension: 0.05 }, spectators(), recent, () => 0.0, 0.6, 0.4)
  expect(picks.length).toBeLessThanOrEqual(1)
})

test('高张力(妙手/漏着)→ 至少一人发言', () => {
  const recent = new Map<string, number>() // 都没说过
  const picks = pickSpeakers({ ...base, kind: 'blunder', tension: 0.95 }, spectators(), recent, () => 0.9, 0.6, 0.4)
  expect(picks.length).toBeGreaterThanOrEqual(1)
})

test('最近刚发言的人被惩罚,不容易连续刷屏', () => {
  const recent = new Map<string, number>([['netizen', 0]]) // 阿强刚说过
  const picks = pickSpeakers({ ...base, tension: 0.9 }, spectators(), recent, () => 0.5, 0.6, 0.4)
  // 阿强即便分高也因惩罚靠后;不应是唯一且必然
  expect(picks).not.toEqual(['netizen'])
})

test('一次最多 2 人发言(不全员刷屏)', () => {
  const recent = new Map<string, number>()
  const picks = pickSpeakers({ ...base, tension: 1 }, spectators(), recent, () => 0.99, 0.6, 0.4, 2)
  expect(picks.length).toBeLessThanOrEqual(2)
})

const cands: Persona[] = [
  { id: 'laopaoer', name: '炮儿爷', isPlayer: false, skill: 'strong', background: '', voice: '', leaning: '' },
  { id: 'coach', name: '林教练', isPlayer: false, skill: 'medium', background: '', voice: '', leaning: '' },
]
const stim = { kind: 'move', gameId: 1, scoreCp: 0, tension: 0.9 } as unknown as Stimulus

describe('pickSpeakers 参数化', () => {
  it('threshold=2(高于任何分)→ 没人说话', () => {
    expect(pickSpeakers(stim, cands, new Map(), () => 0.5, 2, 0.4)).toHaveLength(0)
  })
  it('threshold=0(低)→ 有人说话', () => {
    expect(pickSpeakers(stim, cands, new Map(), () => 0.5, 0, 0.4).length).toBeGreaterThan(0)
  })
})

import { pickSpeakers as pick2 } from './speaker-select.js'
describe('pickSpeakers maxSpeakers', () => {
  const cands = [
    { id: 'laopaoer', name: 'a', isPlayer: false, skill: 'strong', background: '', voice: '', leaning: '' },
    { id: 'coach', name: 'b', isPlayer: false, skill: 'medium', background: '', voice: '', leaning: '' },
    { id: 'netizen', name: 'c', isPlayer: false, skill: 'weak', background: '', voice: '', leaning: '' },
  ] as any
  const stim = { kind: 'move', gameId: 1, scoreCp: 0, tension: 0.95 } as any
  it('maxSpeakers=1 → 最多 1 人', () => {
    expect(pick2(stim, cands, new Map(), () => 0.5, 0, 0.4, 1).length).toBeLessThanOrEqual(1)
  })
  it('maxSpeakers=3 → 可超过 2 人', () => {
    expect(pick2(stim, cands, new Map(), () => 0.5, 0, 0.4, 3).length).toBe(3)
  })
})
