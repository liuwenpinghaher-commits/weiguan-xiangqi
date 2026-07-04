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
  it('llm: model 字符串透传;apiKey 空串→null(显式清除,而非丢弃)', () => {
    expect(validateSection('llm', { model: 'qwen-max', apiKey: '' })).toEqual({ model: 'qwen-max', apiKey: null })
  })
  it('llm: apiKey/baseURL 可显式清回 null(null/空串→null,非空串透传)', () => {
    expect(validateSection('llm', { apiKey: null })).toEqual({ apiKey: null })
    expect(validateSection('llm', { apiKey: '' })).toEqual({ apiKey: null })
    expect(validateSection('llm', { apiKey: 'sk-x' })).toEqual({ apiKey: 'sk-x' })
    expect(validateSection('llm', { baseURL: null })).toEqual({ baseURL: null })
    expect(validateSection('llm', { baseURL: '   ' })).toEqual({ baseURL: null })
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
  it('director: modeCleaner 丢弃 NaN', () => {
    expect(validateSection('director', { coach: { maxDropCp: NaN, strength: 0.5 } })).toEqual({ coach: { strength: 0.5 } })
  })
  it('director: targetBand low>high 时交换,保证 low≤high', () => {
    expect(validateSection('director', { humanlike: { targetBand: { low: 300, high: -100 } } }))
      .toEqual({ humanlike: { targetBand: { low: -100, high: 300 } } })
  })
  it('director: targetBand low≤high 时原样保留', () => {
    expect(validateSection('director', { coach: { targetBand: { low: -100, high: 300 } } }))
      .toEqual({ coach: { targetBand: { low: -100, high: 300 } } })
  })
  it('engine: pikafishPath=null 透传(用于清空路径)', () => {
    expect(validateSection('engine', { pikafishPath: null })).toEqual({ pikafishPath: null })
  })
})
