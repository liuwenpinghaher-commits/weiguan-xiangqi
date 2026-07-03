import type { SettingsRepo } from '../store/settings-repo.js'
import { DEFAULTS, type ChatCfg, type DirectorCfg, type EngineCfg, type DiagnoseCfg, type LlmCfg, type TtsCfg, type ConfigSection } from './defaults.js'
import { validateSection } from './validate.js'
import type { Persona, PersonaId } from '../types.js'
import { PERSONAS } from '../personas/personas.js'
import { DEFAULT_VOICE_PROFILES, DEFAULT_REFERENCE_AUDIO, defaultVoiceProfile, type VoiceProfile } from '../voice/voice-profiles.js'
import type { PersonaConfig } from '../store/settings-repo.js'

/** 代码默认值 ⊕ 数据库覆盖 的唯一读取入口。每次读都合并,保证即时生效。 */
export class RuntimeConfig {
  /** 由 ws-server 设置:llm/tts 段变更时重建 MutableLLM 内层 */
  onLlmChange?: () => void

  constructor(private repo: SettingsRepo, private now: () => string = () => new Date().toISOString()) {}

  private merged<T>(section: ConfigSection): T {
    const base = DEFAULTS[section] as any
    const ov = this.repo.getSection(section) ?? {}
    return { ...base, ...ov } as T
  }

  getChat(): ChatCfg { return this.merged<ChatCfg>('chat') }
  getEngineParams(): EngineCfg { return this.merged<EngineCfg>('engine') }
  getDiagnose(): DiagnoseCfg { return this.merged<DiagnoseCfg>('diagnose') }
  getTts(): TtsCfg { return this.merged<TtsCfg>('tts') }

  getDirectorDefaults(): DirectorCfg {
    const ov = (this.repo.getSection('director') ?? {}) as Partial<DirectorCfg>
    const merge = (m: 'coach' | 'humanlike') => ({
      ...DEFAULTS.director[m], ...(ov[m] ?? {}),
      targetBand: { ...DEFAULTS.director[m].targetBand, ...((ov[m] as any)?.targetBand ?? {}) },
    })
    return { coach: merge('coach'), humanlike: merge('humanlike') }
  }

  getLlm(): LlmCfg {
    const m = this.merged<LlmCfg>('llm')
    return {
      apiKey: m.apiKey ?? process.env.DASHSCOPE_API_KEY ?? null,
      model: m.model,
      baseURL: m.baseURL ?? process.env.DASHSCOPE_BASE_URL ?? null,
    }
  }

  updateSection(section: ConfigSection, patch: Record<string, unknown>): void {
    const clean = validateSection(section, patch)
    const cur = this.repo.getSection(section) ?? {}
    this.repo.setSection(section, { ...cur, ...clean }, this.now())
    if (section === 'llm' || section === 'tts') this.onLlmChange?.()
  }

  /** 懒播种:persona_config 为空时用 PERSONAS + 各角色专属默认音色写入 */
  private ensureSeeded(): void {
    if (!this.repo.personaConfigEmpty()) return
    const seed: PersonaConfig[] = PERSONAS.map(p => ({
      id: p.id, name: p.name, isPlayer: p.isPlayer, skill: p.skill,
      background: p.background, voiceStyle: p.voice, leaning: p.leaning,
      ttsVoice: DEFAULT_VOICE_PROFILES[p.id]?.referenceAudio ?? DEFAULT_REFERENCE_AUDIO, enabled: true,
    }))
    this.repo.seedPersonas(seed, this.now())
  }

  /** 启用的角色,映射回 Persona 形状(voiceStyle→voice) */
  personas(): Persona[] {
    this.ensureSeeded()
    return this.repo.getAllPersonas().filter(p => p.enabled).map(p => ({
      id: p.id as PersonaId, name: p.name, isPlayer: p.isPlayer, skill: p.skill as Persona['skill'],
      background: p.background, voice: p.voiceStyle, leaning: p.leaning,
    }))
  }

  getPersona(id: PersonaId): Persona {
    const p = this.personas().find(x => x.id === id)
    if (!p) throw new Error(`unknown persona: ${id}`)
    return p
  }

  /** 逐角色 tts VoiceProfile;以默认档为底,叠加控制台改过的 ttsVoice(覆盖 referenceAudio) */
  voiceProfileForPersona(id: string): VoiceProfile {
    this.ensureSeeded()
    const base = DEFAULT_VOICE_PROFILES[id] ?? defaultVoiceProfile()
    // 读取该 persona 在 repo 里的 ttsVoice(控制台可改);非空时覆盖 referenceAudio。
    const cfg = this.repo.getAllPersonas().find(p => p.id === id)
    if (cfg && typeof cfg.ttsVoice === 'string' && cfg.ttsVoice.trim() !== '') {
      return { ...base, referenceAudio: cfg.ttsVoice }
    }
    return base
  }

  updatePersona(id: PersonaId, patch: Partial<Omit<PersonaConfig, 'id'>>): void {
    this.ensureSeeded()
    this.repo.updatePersona(id, patch, this.now())
  }

  resetPersona(id: PersonaId): void {
    this.ensureSeeded()
    this.repo.resetPersona(id)
    const p = PERSONAS.find(x => x.id === id)
    if (p) this.repo.seedPersonas([{
      id: p.id, name: p.name, isPlayer: p.isPlayer, skill: p.skill,
      background: p.background, voiceStyle: p.voice, leaning: p.leaning,
      ttsVoice: DEFAULT_VOICE_PROFILES[p.id]?.referenceAudio ?? DEFAULT_REFERENCE_AUDIO, enabled: true,
    }], this.now())
  }

  /** 控制台用:原始 persona_config 行(含 ttsVoice/enabled) */
  personaConfigs(): PersonaConfig[] {
    this.ensureSeeded()
    return this.repo.getAllPersonas()
  }
}
