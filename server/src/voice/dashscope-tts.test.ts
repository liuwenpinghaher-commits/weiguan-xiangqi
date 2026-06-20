import { test, expect } from 'vitest'
import { voiceForPersona } from './dashscope-tts.js'

test('player → Ethan', () => {
  expect(voiceForPersona('player')).toBe('Ethan')
})

test('laopaoer → Dylan (北京话男声)', () => {
  expect(voiceForPersona('laopaoer')).toBe('Dylan')
})

test('coach → Serena', () => {
  expect(voiceForPersona('coach')).toBe('Serena')
})

test('netizen → Eric', () => {
  expect(voiceForPersona('netizen')).toBe('Eric')
})

test('未知人设 → 默认 Cherry', () => {
  expect(voiceForPersona('unknown')).toBe('Cherry')
  expect(voiceForPersona('')).toBe('Cherry')
  expect(voiceForPersona('human')).toBe('Cherry')
})
