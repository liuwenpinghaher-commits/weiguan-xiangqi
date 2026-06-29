import { describe, it, expect, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { SettingsRepo } from '../store/settings-repo.js'
import { RuntimeConfig } from './runtime-config.js'
import { DEFAULTS } from './defaults.js'
import { PERSONAS } from '../personas/personas.js'
import { DEFAULT_VOICE_PROFILES } from '../voice/voice-profiles.js'

function cfg() { return new RuntimeConfig(new SettingsRepo(openDb(':memory:')), () => '2026-06-20T00:00:00.000Z') }

describe('RuntimeConfig 段配置', () => {
  it('无覆盖时 getter 返回 DEFAULTS', () => {
    expect(cfg().getChat()).toEqual(DEFAULTS.chat)
    expect(cfg().getEngineParams()).toEqual(DEFAULTS.engine)
  })
  it('updateSection 后 getter 反映合并结果(默认 ⊕ 覆盖)', () => {
    const c = cfg()
    c.updateSection('chat', { speakThreshold: 0.8 })
    expect(c.getChat().speakThreshold).toBe(0.8)
    expect(c.getChat().maxPerMin).toBe(DEFAULTS.chat.maxPerMin)
  })
  it('updateSection 钳制非法值', () => {
    const c = cfg()
    c.updateSection('engine', { multipv: 999 })
    expect(c.getEngineParams().multipv).toBe(10)
  })
  it('llm getter 缺 apiKey 时回退 env', () => {
    const c = cfg()
    process.env.DASHSCOPE_API_KEY = 'sk-env'
    try { expect(c.getLlm().apiKey).toBe('sk-env') } finally { delete process.env.DASHSCOPE_API_KEY }
  })
  it('库里 llm.apiKey 优先于 env', () => {
    const c = cfg()
    process.env.DASHSCOPE_API_KEY = 'sk-env'
    try { c.updateSection('llm', { apiKey: 'sk-db' }); expect(c.getLlm().apiKey).toBe('sk-db') }
    finally { delete process.env.DASHSCOPE_API_KEY }
  })
  it('更新 llm/tts 段触发 onLlmChange,其它段不触发', () => {
    const c = cfg(); const hook = vi.fn(); c.onLlmChange = hook
    c.updateSection('chat', { reactProb: 0.5 }); expect(hook).not.toHaveBeenCalled()
    c.updateSection('llm', { model: 'qwen-max' }); expect(hook).toHaveBeenCalledTimes(1)
    c.updateSection('tts', { referenceAudio: 'custom.wav' }); expect(hook).toHaveBeenCalledTimes(2)
  })
  it('director 段按 mode 深合并', () => {
    const c = cfg()
    c.updateSection('director', { humanlike: { strength: 0.9 } })
    expect(c.getDirectorDefaults().humanlike.strength).toBe(0.9)
    expect(c.getDirectorDefaults().humanlike.maxDropCp).toBe(DEFAULTS.director.humanlike.maxDropCp)
    expect(c.getDirectorDefaults().coach).toEqual(DEFAULTS.director.coach)
  })
})

describe('RuntimeConfig personas', () => {
  it('首次访问自动从 PERSONAS 播种,personas() 返回全部', () => {
    const c = cfg()
    const ps = c.personas()
    expect(ps).toHaveLength(PERSONAS.length)
    const coach = ps.find(p => p.id === 'coach')!
    expect(coach.name).toBe('林教练')
    expect(coach.isPlayer).toBe(false)
  })
  it('voiceProfileForPersona 默认取自 DEFAULT_VOICE_PROFILES', () => {
    const c = cfg()
    expect(c.voiceProfileForPersona('laopaoer')).toEqual(DEFAULT_VOICE_PROFILES.laopaoer)
  })
  it('未知 persona 回退 defaultVoiceProfile', () => {
    const c = cfg()
    const p = c.voiceProfileForPersona('unknown')
    expect(p.audioTemperature).toBe(0.8)
  })
  it('updatePersona 改名/音色后即时反映', () => {
    const c = cfg(); c.personas()
    c.updatePersona('coach', { name: '林老师', ttsVoice: 'custom_ref.wav' })
    expect(c.personas().find(p => p.id === 'coach')!.name).toBe('林老师')
    // 改了 ttsVoice 后 voiceProfileForPersona 应反映:referenceAudio 被覆盖,其余档位保持默认
    expect(c.voiceProfileForPersona('coach')).toEqual({ ...DEFAULT_VOICE_PROFILES.coach, referenceAudio: 'custom_ref.wav' })
  })
  it('voiceProfileForPersona 读取控制台改过的 ttsVoice 覆盖 referenceAudio', () => {
    const c = cfg(); c.personas()
    // 默认播种时 ttsVoice=DEFAULT_REFERENCE_AUDIO → 返回纯默认档
    expect(c.voiceProfileForPersona('laopaoer')).toEqual(DEFAULT_VOICE_PROFILES.laopaoer)
    // 控制台改 ttsVoice 后,该函数返回应反映改动(referenceAudio 覆盖),其余字段仍为默认档
    c.updatePersona('laopaoer', { ttsVoice: 'assets/tts/laopaoer.wav' })
    const vp = c.voiceProfileForPersona('laopaoer')
    expect(vp.referenceAudio).toBe('assets/tts/laopaoer.wav')
    expect(vp.audioTemperature).toBe(DEFAULT_VOICE_PROFILES.laopaoer.audioTemperature)
    expect(vp.maxNewFrames).toBe(DEFAULT_VOICE_PROFILES.laopaoer.maxNewFrames)
  })
  it('resetPersona 恢复默认(重新播种该行)', () => {
    const c = cfg(); c.personas()
    c.updatePersona('coach', { name: '改过的' })
    c.resetPersona('coach')
    expect(c.personas().find(p => p.id === 'coach')!.name).toBe('林教练')
  })
  it('getPersona 返回 Persona 形状(voice=voiceStyle)', () => {
    const c = cfg()
    const p = c.getPersona('laopaoer')
    expect(p.voice).toBe(PERSONAS.find(x => x.id === 'laopaoer')!.voice)
  })
})
