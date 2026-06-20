import { test, expect } from 'vitest'
import { PERSONAS, spectators, getPersona } from './personas.js'

test('预置 1 棋手 + 3 观棋者,各有不同棋力档', () => {
  expect(PERSONAS).toHaveLength(4)
  expect(PERSONAS.filter(p => p.isPlayer)).toHaveLength(1)
  expect(spectators()).toHaveLength(3)
  const tiers = new Set(spectators().map(p => p.skill))
  expect(tiers.size).toBeGreaterThanOrEqual(2) // 棋力档有区分
})

test('getPersona 按 id 取回,缺失抛错', () => {
  expect(getPersona('coach').name).toBeTruthy()
  expect(() => getPersona('nope' as any)).toThrow()
})

test('每个角色档案字段完整', () => {
  for (const p of PERSONAS) {
    expect(p.background.length).toBeGreaterThan(4)
    expect(p.voice.length).toBeGreaterThan(2)
    expect(p.leaning.length).toBeGreaterThan(2)
  }
})
