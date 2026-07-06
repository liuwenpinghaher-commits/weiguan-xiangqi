import { describe, it, expect } from 'vitest'
import { PARAM_FIELDS, displayMaskedKey } from './console-data.js'

describe('console-data', () => {
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
  it('PARAM_FIELDS.chat 含 maxSpeakers 项(范围 1-3,step 1)', () => {
    const f = PARAM_FIELDS.chat.find(x => x.key === 'maxSpeakers')
    expect(f).toBeDefined()
    expect(f!.min).toBe(1)
    expect(f!.max).toBe(3)
    expect(f!.step).toBe(1)
    expect(f!.label).toBe('每步发言人数')
  })
  it('displayMaskedKey 空值显示占位', () => {
    expect(displayMaskedKey('')).toBe('(未设置)')
    expect(displayMaskedKey('sk-****1Xqy')).toBe('sk-****1Xqy')
  })
  it('displayMaskedKey null 也显示占位', () => {
    expect(displayMaskedKey(null)).toBe('(未设置)')
  })
})
