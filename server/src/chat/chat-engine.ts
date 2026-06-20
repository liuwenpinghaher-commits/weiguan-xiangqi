import type { LLMProvider } from '../llm/provider.js'
import type { PersonaMemoryRepo } from '../memory/persona-memory-repo.js'
import type { ChatLine, Stimulus, Persona, PersonaId } from '../types.js'
import { spectators, getPersona } from '../personas/personas.js'
import { viewScore } from '../personas/engine-view.js'
import { pickSpeakers } from './speaker-select.js'
import { TempoGuard } from './tempo.js'

export interface ChatEngineDeps {
  llm: LLMProvider
  mem: PersonaMemoryRepo
  now: () => number
  emit: (line: ChatLine) => void
  rng: () => number
  tempo: { minSilenceMs: number; maxPerMin: number }
}

/** 去标点、转小写,用于去重比较 */
function normalize(s: string): string {
  return s.replace(/[，。！？,!?.、：:；;\s]/g, '').toLowerCase()
}

export class ChatEngine {
  private guard: TempoGuard
  private lastSpokeAt = new Map<string, number>()  // personaId -> ms
  private lastText = new Map<string, string>()       // personaId -> 上次 emit 文本(原文)

  constructor(private deps: ChatEngineDeps) {
    this.guard = new TempoGuard({ ...deps.tempo, now: deps.now })
  }

  async onStimulus(stim: Stimulus): Promise<void> {
    if (!this.guard.allow()) return
    const recentSecs = this.recentMap()
    const speakers = pickSpeakers(stim, spectators(), recentSecs, this.deps.rng)

    // 若这步是 AI 棋手走的,以 40% 概率让 player 自评(放末尾)
    if (stim.byPlayerPersona && this.deps.rng() < 0.4) {
      speakers.push('player')
    }

    if (speakers.length === 0) return
    this.guard.record()
    for (const id of speakers) {
      try {
        const persona = getPersona(id)
        const text = (await this.deps.llm.chat(this.buildPrompt(persona, stim), {
          disableThinking: true, maxTokens: 80,
        })).trim()
        if (!text) continue

        // 去重护栏:与上次发言内容相同或互相包含则跳过
        const prev = this.lastText.get(id)
        if (prev !== undefined) {
          const normText = normalize(text)
          const normPrev = normalize(prev)
          if (normText === normPrev || normText.includes(normPrev) || normPrev.includes(normText)) {
            continue
          }
        }

        const line: ChatLine = {
          gameId: stim.gameId,
          personaId: id,
          text,
          addressee: this.addressee(stim),
          ts: new Date(this.deps.now()).toISOString(),
        }
        this.deps.emit(line)
        this.lastText.set(id, text)
        this.deps.mem.add({
          personaId: id,
          kind: 'episode',
          content: text,
          importance: 1,
          gameId: stim.gameId,
          createdAt: line.ts,
        })
        this.lastSpokeAt.set(id, this.deps.now())
      } catch {
        // 单个 speaker LLM 失败:跳过该 speaker,不影响其他人
        continue
      }
    }
  }

  private buildPrompt(p: Persona, stim: Stimulus) {
    const seen = viewScore(stim.scoreCp, p.skill, this.deps.rng)

    // 局势定性描述
    let qual: string
    if (seen === null) {
      qual = '局势未明'
    } else if (seen > 200) {
      qual = '红方大优'
    } else if (seen >= 80) {
      qual = '红方占优'
    } else if (seen > -80) {
      qual = '大致均势'
    } else if (seen >= -200) {
      qual = '黑方占优'
    } else {
      qual = '黑方大优'
    }

    const facts = this.deps.mem
      .retrieve(p.id, stim.moveZh ?? stim.humanText ?? stim.kind, 3, this.deps.now, ['fact', 'insight'])
      .map(m => '· ' + m.content).join('\n') || '(还不了解)'

    const sys = `你是「${p.name}」:${p.background} 口吻:${p.voice} 立场:${p.leaning}\n`
      + `你在围观一局中国象棋,用你的水平和脾气,针对刚走的这步说一句(≤25字),可抛棋招/调侃/拉踩,允许看走眼。别空泛说"看不懂",要点到具体的子或着法。只输出这一句。\n`
      + `你对这位棋手的了解:\n${facts}`

    let user: string
    if (stim.kind === 'human_said') {
      user = `玩家刚说:"${stim.humanText}"。回他一句:`
    } else if (p.isPlayer && stim.byPlayerPersona) {
      user = `你(${p.name})刚走了「${stim.moveZh ?? '一步'}」,当前${qual}。自评一句(≤25字,别空泛):`
    } else if (stim.moveZh) {
      user = `第${stim.ply ?? '?'}手(${stim.phase ?? ''}):${stim.moveZh}。当前${qual}。说一句:`
    } else {
      user = `刚走了一步棋,当前${qual}。说一句:`
    }

    return [
      { role: 'system' as const, content: sys },
      { role: 'user' as const, content: user },
    ]
  }

  private addressee(stim: Stimulus): ChatLine['addressee'] {
    return stim.kind === 'human_said' ? 'human' : 'all'
  }

  private recentMap(): Map<string, number> {
    const t = this.deps.now()
    const m = new Map<string, number>()
    for (const [id, ts] of this.lastSpokeAt) m.set(id, (t - ts) / 1000)
    return m
  }
}
