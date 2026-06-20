import { describe, it, expect } from 'vitest'
import { maskKey } from './mask.js'

describe('maskKey', () => {
  it('长 key:前 3 后 4 之间打码', () => {
    expect(maskKey('sk-abcdef1Xqy')).toBe('sk-****1Xqy')
  })
  it('null/空 → 空串', () => {
    expect(maskKey(null)).toBe('')
    expect(maskKey('')).toBe('')
  })
  it('过短 key(<=7)全打码', () => {
    expect(maskKey('short')).toBe('****')
  })
})
