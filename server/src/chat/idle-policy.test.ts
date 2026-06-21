import { describe, it, expect } from 'vitest'
import { idleShouldFire } from './idle-policy.js'

describe('idleShouldFire', () => {
  const base = { hasGame: true, paused: false, silentMs: 40000, silenceThresholdMs: 30000, roll: 0.1, prob: 0.35 }
  it('沉默够久+有局+未暂停+roll<prob → 触发', () => {
    expect(idleShouldFire(base)).toBe(true)
  })
  it('沉默不足 → 不触发', () => {
    expect(idleShouldFire({ ...base, silentMs: 5000 })).toBe(false)
  })
  it('暂停 / 无局 → 不触发', () => {
    expect(idleShouldFire({ ...base, paused: true })).toBe(false)
    expect(idleShouldFire({ ...base, hasGame: false })).toBe(false)
  })
  it('roll≥prob → 不触发', () => {
    expect(idleShouldFire({ ...base, roll: 0.9 })).toBe(false)
  })
})
