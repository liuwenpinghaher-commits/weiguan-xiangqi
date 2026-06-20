import { describe, it, expect } from 'vitest'
import { VOICES, PARAM_FIELDS, displayMaskedKey } from './console-data.js'

describe('console-data', () => {
  it('VOICES 含已验证可用音色', () => {
    const ids = VOICES.map(v => v.id)
    for (const id of ['Dylan', 'Ethan', 'Serena', 'Eric', 'Cherry', 'Chelsie', 'Kiki', 'Rocky', 'Jada', 'Sunny']) {
      expect(ids).toContain(id)
    }
  })
  it('PARAM_FIELDS 覆盖 chat/engine/diagnose 段,每字段有 label/min/max', () => {
    expect(PARAM_FIELDS.chat.length).toBeGreaterThan(0)
    expect(PARAM_FIELDS.engine.length).toBeGreaterThan(0)
    expect(PARAM_FIELDS.diagnose.length).toBeGreaterThan(0)
    for (const f of PARAM_FIELDS.chat) {
      expect(typeof f.label).toBe('string')
      expect(typeof f.min).toBe('number')
      expect(typeof f.max).toBe('number')
      expect(typeof f.key).toBe('string')
    }
  })
  it('displayMaskedKey 空值显示占位', () => {
    expect(displayMaskedKey('')).toBe('(未设置)')
    expect(displayMaskedKey('sk-****1Xqy')).toBe('sk-****1Xqy')
  })
  it('displayMaskedKey null 也显示占位', () => {
    expect(displayMaskedKey(null)).toBe('(未设置)')
  })
})
