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

/** 最近聊天缓冲条目 */
interface RecentEntry {
  name: string
  text: string
}

const RECENT_CAPACITY = 8  // 每个 gameId 最多保留最近 8 条

/** 去标点、转小写,用于去重比较 */
function normalize(s: string): string {
  return s.replace(/[，。！？,!?.、：:；;\s]/g, '').toLowerCase()
}

export class ChatEngine {
  private guard: TempoGuard
  private lastSpokeAt = new Map<string, number>()  // personaId -> ms
  private lastText = new Map<string, string>()       // personaId -> 上次 emit 文本(原文)
  /** 按 gameId 维护最近聊天缓冲(含角色和玩家发言),用于给下一个说话者注入上下文 */
  private recent = new Map<number, RecentEntry[]>()

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

    /** 本回合已发言的条目,串行注入给下一个 speaker */
    const roundSoFar: RecentEntry[] = []

    for (const id of speakers) {
      try {
        const persona = getPersona(id)

        // 取该 gameId 的 recent(最近若干条) + 本回合前面已说的,合并为上下文
        const gameRecent = this.recent.get(stim.gameId) ?? []
        const context: RecentEntry[] = [...gameRecent, ...roundSoFar]

        const text = (await this.deps.llm.chat(this.buildPrompt(persona, stim, context), {
          disableThinking: true, maxTokens: 80,
        })).trim()
        if (!text) continue

        // 去重护栏:与上次发言去标点后完全相同才跳过(只杀逐字复读,不误杀近似不同句)
        const prev = this.lastText.get(id)
        if (prev !== undefined && normalize(text) === normalize(prev)) {
          continue
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

        // 推入本回合已发言数组(供后续 speaker 看到)
        const entry: RecentEntry = { name: persona.name, text }
        roundSoFar.push(entry)

        // 推入全局 recent 缓冲(跨刺激记忆)
        this.pushRecent(stim.gameId, entry)
      } catch {
        // 单个 speaker LLM 失败:跳过该 speaker,不影响其他人
        continue
      }
    }
  }

  /** 将一条发言推入 gameId 对应的 recent 缓冲,超出容量时丢最旧 */
  private pushRecent(gameId: number, entry: RecentEntry): void {
    if (!this.recent.has(gameId)) {
      this.recent.set(gameId, [])
    }
    const buf = this.recent.get(gameId)!
    buf.push(entry)
    if (buf.length > RECENT_CAPACITY) {
      buf.splice(0, buf.length - RECENT_CAPACITY)
    }
  }

  private buildPrompt(p: Persona, stim: Stimulus, context: RecentEntry[]) {
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

    // 最近聊天上下文段(为空时提示刚开局)
    const contextLine = context.length > 0
      ? context.map(c => `- ${c.name}:${c.text}`).join('\n')
      : '(刚开局,还没人说话)'

    const sys = `你是「${p.name}」:${p.background} 口吻:${p.voice} 立场:${p.leaning}\n`
      + `你在围观一局中国象棋,用你的水平和脾气说一句(≤25字),可抛棋招/调侃/拉踩,允许看走眼。你懂棋,适时可抛个棋谚或小典故。只输出这一句。\n`
      + `你可以顺着别人的话接、抬杠或拉踩某位棋友,也可以只评这步棋;像真人围观那样自然。\n`
      + `你对这位棋手的了解:\n${facts}\n`
      + `最近这桌在聊(可点名回应、拉踩、抬杠或附和某人):\n${contextLine}`

    let user: string
    if (stim.kind === 'human_said') {
      user = `玩家刚说:"${stim.humanText}"。回他一句:`
    } else if (stim.kind === 'long_think') {
      user = `玩家这步想了很久还没落子,用你的脾气调侃/安慰/施压一句:`
    } else if (stim.kind === 'idle' || (stim.kind === 'topic_open' && !stim.moveZh)) {
      user = `棋局正平静,随口聊点棋外的(行业/往事/家常)或讲个棋坛掌故/棋谚/开局套路,一句话,别评具体某步:`
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
