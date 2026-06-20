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

export class ChatEngine {
  private guard: TempoGuard
  private lastSpokeAt = new Map<string, number>()  // personaId -> ms

  constructor(private deps: ChatEngineDeps) {
    this.guard = new TempoGuard({ ...deps.tempo, now: deps.now })
  }

  async onStimulus(stim: Stimulus): Promise<void> {
    if (!this.guard.allow()) return
    const recentSecs = this.recentMap()
    const speakers = pickSpeakers(stim, spectators(), recentSecs, this.deps.rng)
    if (speakers.length === 0) return
    this.guard.record()
    for (const id of speakers) {
      const persona = getPersona(id)
      const text = (await this.deps.llm.chat(this.buildPrompt(persona, stim), {
        disableThinking: true, maxTokens: 80,
      })).trim()
      if (!text) continue
      const line: ChatLine = {
        gameId: stim.gameId,
        personaId: id,
        text,
        addressee: this.addressee(stim),
        ts: new Date(this.deps.now()).toISOString(),
      }
      this.deps.emit(line)
      this.deps.mem.add({
        personaId: id,
        kind: 'episode',
        content: text,
        importance: 1,
        gameId: stim.gameId,
        createdAt: line.ts,
      })
      this.lastSpokeAt.set(id, this.deps.now())
    }
  }

  private buildPrompt(p: Persona, stim: Stimulus) {
    const seen = viewScore(stim.scoreCp, p.skill, this.deps.rng)
    const mems = this.deps.mem.retrieve(p.id as PersonaId, stim.humanText ?? stim.kind, 4, this.deps.now)
    const memText = mems.map(m => '· ' + m.content).join('\n') || '(暂无)'
    const sys = `你是「${p.name}」:${p.background} 口吻:${p.voice} 立场:${p.leaning}\n`
      + `你是观棋者,正在围观一局中国象棋。用一句话(≤25字)即兴点评/拉踩/接梗,像真人棋友,可以看走眼、有脾气。只输出这句话。\n`
      + `你对这个玩家的记忆:\n${memText}`
    const user = stim.kind === 'human_said'
      ? `玩家刚说:"${stim.humanText}"。回他一句:`
      : `刚发生:${stim.kind};你看到的局势评分(你的水平视角,可能不准):${seen ?? '看不清'}。说一句:`
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
