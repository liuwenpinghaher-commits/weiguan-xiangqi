import { describe, it, expect, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { SettingsRepo } from '../store/settings-repo.js'
import { RuntimeConfig } from './runtime-config.js'
import { DEFAULTS } from './defaults.js'

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
    c.updateSection('tts', { model: 'x' }); expect(hook).toHaveBeenCalledTimes(2)
  })
  it('director 段按 mode 深合并', () => {
    const c = cfg()
    c.updateSection('director', { humanlike: { strength: 0.9 } })
    expect(c.getDirectorDefaults().humanlike.strength).toBe(0.9)
    expect(c.getDirectorDefaults().humanlike.maxDropCp).toBe(DEFAULTS.director.humanlike.maxDropCp)
    expect(c.getDirectorDefaults().coach).toEqual(DEFAULTS.director.coach)
  })
})
