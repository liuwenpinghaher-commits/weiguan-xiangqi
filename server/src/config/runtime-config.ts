import type { SettingsRepo } from '../store/settings-repo.js'
import { DEFAULTS, type ChatCfg, type DirectorCfg, type EngineCfg, type DiagnoseCfg, type LlmCfg, type TtsCfg, type ConfigSection } from './defaults.js'
import { validateSection } from './validate.js'

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
}
