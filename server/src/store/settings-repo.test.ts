import { describe, it, expect } from 'vitest'
import { openDb } from './db.js'
import { SettingsRepo } from './settings-repo.js'

function repo() { return new SettingsRepo(openDb(':memory:')) }

describe('SettingsRepo app_settings', () => {
  it('未写时 getSection 返回 null', () => {
    expect(repo().getSection('chat')).toBeNull()
  })
  it('setSection 后 getSection 取回同一 JSON', () => {
    const r = repo()
    r.setSection('chat', { speakThreshold: 0.7 }, '2026-06-20T00:00:00.000Z')
    expect(r.getSection('chat')).toEqual({ speakThreshold: 0.7 })
  })
  it('setSection 覆盖式替换同段', () => {
    const r = repo()
    r.setSection('llm', { model: 'a' }, 't1')
    r.setSection('llm', { model: 'b' }, 't2')
    expect(r.getSection('llm')).toEqual({ model: 'b' })
  })
})

describe('SettingsRepo persona_config', () => {
  const seed = [{
    id: 'coach', name: '林教练', isPlayer: false, skill: 'medium',
    background: 'bg', voiceStyle: '温和', leaning: '偏帮你', ttsVoice: 'Serena', enabled: true,
  }]
  it('isEmpty + seed + getAll 往返', () => {
    const r = repo()
    expect(r.personaConfigEmpty()).toBe(true)
    r.seedPersonas(seed, 't0')
    expect(r.personaConfigEmpty()).toBe(false)
    const all = r.getAllPersonas()
    expect(all).toHaveLength(1)
    expect(all[0]).toMatchObject({ id: 'coach', name: '林教练', isPlayer: false, ttsVoice: 'Serena', enabled: true })
  })
  it('updatePersona 改部分字段,resetPersona 删除该行', () => {
    const r = repo()
    r.seedPersonas(seed, 't0')
    r.updatePersona('coach', { name: '林老师', ttsVoice: 'Cherry' }, 't1')
    const row = r.getAllPersonas()[0]
    expect(row.name).toBe('林老师'); expect(row.ttsVoice).toBe('Cherry')
    r.resetPersona('coach')
    expect(r.getAllPersonas()).toHaveLength(0)
  })
})
