import { describe, it, expect } from 'vitest'
import { maskKey } from './mask.js'

describe('maskKey', () => {
  it('长 key(>11):前 3 后 4 之间打码', () => {
    expect(maskKey('sk-abcdef1Xqy')).toBe('sk-****1Xqy')
  })
  it('null/空 → 空串', () => {
    expect(maskKey(null)).toBe('')
    expect(maskKey('')).toBe('')
  })
  it('过短 key(<=4)全打码', () => {
    expect(maskKey('shor')).toBe('****')
  })
  it('中等长度(8,原先会露 7/8)只露前 1 后 1,中间全遮', () => {
    // length=8:旧实现露 sk-****cdef(露 7 位);新实现只露首尾各 1
    expect(maskKey('abcdefgh')).toBe('a****h')
  })
  it('边界 length=11:仍只露前 1 后 1(不到 >11 阈值)', () => {
    expect(maskKey('abcdefghijk')).toBe('a****k')
  })
  it('边界 length=12:达到 >11,露前 3 后 4', () => {
    expect(maskKey('abcdefghijkl')).toBe('abc****ijkl')
  })
  it('length=5:不全遮但只露首尾,中间至少遮 3 位', () => {
    expect(maskKey('short')).toBe('s****t')
  })
})
