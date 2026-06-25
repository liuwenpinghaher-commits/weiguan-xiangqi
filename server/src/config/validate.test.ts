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
  it('engine: pikafishPath=null 透传(用于清空路径)', () => {
    expect(validateSection('engine', { pikafishPath: null })).toEqual({ pikafishPath: null })
  })
  it('tts: mossNanoUrl 仅接受本地 http URL(127.0.0.1 或 localhost)', () => {
    expect(validateSection('tts', { mossNanoUrl: 'http://127.0.0.1:18083' }))
      .toEqual({ mossNanoUrl: 'http://127.0.0.1:18083' })
    expect(validateSection('tts', { mossNanoUrl: 'http://localhost:18083' }))
      .toEqual({ mossNanoUrl: 'http://localhost:18083' })
    expect(validateSection('tts', { mossNanoUrl: 'http://evil.example.com/steal' })).toEqual({})
    expect(validateSection('tts', { mossNanoUrl: 'https://127.0.0.1:443' })).toEqual({})
    expect(validateSection('tts', { mossNanoUrl: 'not-a-url' })).toEqual({})
    expect(validateSection('tts', { referenceAudio: 'assets/tts/ref.wav' }))
      .toEqual({ referenceAudio: 'assets/tts/ref.wav' })
    expect(validateSection('tts', { streaming: false })).toEqual({ streaming: false })
  })
})
