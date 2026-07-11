import { describe, expect, it } from 'vitest'
import { isMustKeepForVoice } from './server-tts.js'

describe('server TTS queue policy', () => {
  it('只保护明确对玩家的回答,不保护普通教练弹幕', () => {
    expect(isMustKeepForVoice('coach', 'all')).toBe(false)
    expect(isMustKeepForVoice('coach', undefined)).toBe(false)
    expect(isMustKeepForVoice('coach', 'human')).toBe(true)
    expect(isMustKeepForVoice('netizen', 'human')).toBe(true)
  })
})
