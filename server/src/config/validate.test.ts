import { describe, it, expect } from 'vitest'
import { validateSection } from './validate.js'

describe('validateSection', () => {
  it('chat: 钳制越界数值到合法范围', () => {
    const out = validateSection('chat', { speakThreshold: 5, maxPerMin: -3 })
    expect(out.speakThreshold).toBe(1)
    expect(out.maxPerMin).toBe(0)
  })
  it('chat: 丢弃未知字段', () => {
    expect(validateSection('chat', { speakThreshold: 0.7, bogus: 1 } as any)).toEqual({ speakThreshold: 0.7 })
  })
  it('llm: 字符串字段透传,空串视为未设(转 undefined 丢弃)', () => {
    expect(validateSection('llm', { model: 'qwen-max', apiKey: '' })).toEqual({ model: 'qwen-max' })
  })
  it('engine: multipv 钳到 [1,10],movetime 钳到 [50,5000]', () => {
    expect(validateSection('engine', { multipv: 99, movetime: 1 })).toEqual({ multipv: 10, movetime: 50 })
  })
  it('diagnose: depth 钳到 [1,30]', () => {
    expect(validateSection('diagnose', { depth: 100 })).toEqual({ depth: 30 })
  })
  it('未知 section 抛错', () => {
    expect(() => validateSection('bogus' as any, {})).toThrow()
  })
})
