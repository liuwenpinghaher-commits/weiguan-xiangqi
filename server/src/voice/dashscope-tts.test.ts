import { test, expect } from 'vitest'
import { voiceForPersona } from './dashscope-tts.js'

test('player → longcheng_v2', () => {
  expect(voiceForPersona('player')).toBe('longcheng_v2')
})

test('laopaoer → longhua_v2', () => {
  expect(voiceForPersona('laopaoer')).toBe('longhua_v2')
})

test('coach → longshu_v2', () => {
  expect(voiceForPersona('coach')).toBe('longshu_v2')
})

test('netizen → longshuo_v2', () => {
  expect(voiceForPersona('netizen')).toBe('longshuo_v2')
})

test('未知人设 → 默认 longxiaochun_v2', () => {
  expect(voiceForPersona('unknown')).toBe('longxiaochun_v2')
  expect(voiceForPersona('')).toBe('longxiaochun_v2')
  expect(voiceForPersona('human')).toBe('longxiaochun_v2')
})
