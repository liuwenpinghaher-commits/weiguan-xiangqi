import type { LLMProvider } from '../llm/provider.js'
import type { MemoryStore } from '../memory/store.js'
import type { ChatLine, Stimulus, Persona, PersonaId } from '../types.js'
import type { RuntimeConfig } from '../config/runtime-config.js'
import { viewScore } from '../personas/engine-view.js'
import { pickSpeakers } from './speaker-select.js'
import { TempoGuard } from './tempo.js'

export interface ChatEngineDeps {
  llm: LLMProvider
  mem: MemoryStore
  cfg: RuntimeConfig
  now: () => number
  emit: (line: ChatLine) => void
  rng: () => number
}

/** 最近聊天缓冲条目 */
interface RecentEntry {
  id: PersonaId
  name: string
  text: string
}

const RECENT_CAPACITY = 8  // 每个 gameId 最多保留最近 8 条

/** 去标点、转小写,用于去重比较 */
function normalize(s: string): string {
  return s.replace(/[，。！？,!?.、：:；;\s]/g, '').toLowerCase()
}

/** 平实的局势定性(刻意不夸张,避免动不动"大优"催生满屏感叹) */
function qualWord(seen: number | null): string {
  if (seen === null) return '还看不准'
  if (seen > 250) return '红方明显占上风'
  if (seen >= 90) return '红方稍好'
  if (seen > -90) return '半斤八两'
  if (seen >= -250) return '黑方稍好'
  return '黑方明显占上风'
}

export class ChatEngine {
  private guard: TempoGuard
  private lastSpokeAt = new Map<string, number>()  // personaId -> ms
  private lastText = new Map<string, string>()       // personaId -> 上次 emit 文本(原文)
  /** 按 gameId 维护最近聊天缓冲(含角色和玩家发言),用于给下一个说话者注入上下文 */
  private recent = new Map<number, RecentEntry[]>()

  constructor(private deps: ChatEngineDeps) {
    this.guard = new TempoGuard({
      limits: () => { const c = deps.cfg.getChat(); return { minSilenceMs: c.minSilenceMs, maxPerMin: c.maxPerMin } },
      now: deps.now,
    })
  }

  async onStimulus(stim: Stimulus): Promise<void> {
    if (!this.guard.allow()) return
    const recentSecs = this.recentMap()
    const chat = this.deps.cfg.getChat()
    const speakers = pickSpeakers(stim, this.deps.cfg.personas().filter(p => !p.isPlayer), recentSecs, this.deps.rng, chat.speakThreshold, chat.jitterWidth)

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
        const persona = this.deps.cfg.getPersona(id)

        // 取该 gameId 的 recent(最近若干条) + 本回合前面已说的,合并为上下文
        const gameRecent = this.recent.get(stim.gameId) ?? []
        const context: RecentEntry[] = [...gameRecent, ...roundSoFar]

        const plan = await this.plan(persona, stim, context)
        const text = (await this.deps.llm.chat(plan.messages, {
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
          addressee: plan.addressee,
          ts: new Date(this.deps.now()).toISOString(),
        }
        this.deps.emit(line)
        this.lastText.set(id, text)
        await this.deps.mem.record({
          personaId: id,
          kind: 'episode',
          content: text,
          importance: 1,
          gameId: stim.gameId,
          createdAt: line.ts,
        })
        this.lastSpokeAt.set(id, this.deps.now())

        // 推入本回合已发言数组(供后续 speaker 看到)
        const entry: RecentEntry = { id, name: persona.name, text }
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

  /** 为一个说话者生成 LLM 消息 + 这条说给谁(addressee) */
  private async plan(p: Persona, stim: Stimulus, context: RecentEntry[]): Promise<{
    messages: { role: 'system' | 'user'; content: string }[]
    addressee: ChatLine['addressee']
  }> {
    const c = this.deps.cfg.getChat()
    const seen = viewScore(stim.scoreCp, p.skill, this.deps.rng)
    const qual = qualWord(seen)

    const facts = (await this.deps.mem
      .retrieve(p.id, stim.moveZh ?? stim.humanText ?? stim.kind, 3, ['fact', 'insight']))
      .map(m => '· ' + m.content).join('\n') || '(还不了解)'

    const contextLine = context.length > 0
      ? context.map(c => `- ${c.name}:${c.text}`).join('\n')
      : '(刚开局,还没人说话)'

    const sys = `你是「${p.name}」。${p.background}\n说话像:${p.voice} 立场:${p.leaning}\n`
      + `你蹲在棋摊边看棋。你是懂棋的人,主要在看棋、评棋——这步好不好、为什么、对方该怎么应、有什么威胁、什么棋理路数;也会互相拌嘴、偶尔扯句闲篇,但别通篇耍贫嘴不谈棋。\n`
      + `- 口语、随意,别像电视解说;少用感叹号,只有真出彩或真离谱才激动。\n`
      + `- 长短不一:有时俩字("软了""稳"),有时半句,偶尔一整句把道理说透。别每句一个调。\n`
      + `- 按你的棋力说话:看得准就点到要害、敢报具体着法或变化;水平次的可以看走眼、说句外行话。\n`
      + `- 棋谚、老话、当年的事偶尔自然带一句即可,别空泛套话、别尬吹。\n`
      + `只输出你说的那一句话,不带引号、不加旁白、不写名字前缀。\n`
      + `你对这位棋手的了解:\n${facts}\n`
      + `刚才这桌在聊(可点名回应、抬杠或拉踩):\n${contextLine}`

    // 长度风格:多数偏短,制造节奏
    const lr = this.deps.rng()
    const len = lr < c.lenShortP ? '就两三个字或半句' : lr < c.lenLongP ? '一句话' : '一句话,可稍长但别啰嗦'

    // react 目标:最近一条不是自己说的
    const target = [...context].reverse().find(c => c.id !== p.id)

    let user: string
    let addressee: ChatLine['addressee'] = 'all'
    if (stim.kind === 'human_said') {
      user = `玩家刚冲你们说:"${stim.humanText}"。${len},回他一句,口语自然:`
      addressee = 'human'
    } else if (p.isPlayer && stim.byPlayerPersona) {
      user = `你(${p.name})刚走了「${stim.moveZh ?? '一步'}」,局面${qual}。自评一句:说说你这步的算计或得失,别空吹,${len}:`
    } else if (stim.kind === 'long_think') {
      user = `对方这步想了很久还没落子。${len},用你的脾气随口催两句/调侃/安慰,别太冲:`
    } else if (stim.kind === 'idle' || (stim.kind === 'topic_open' && !stim.moveZh)) {
      user = `这会儿没大事。${len},随口扯点棋外的(你自己的行当/家里/最近遇上的事),或棋摊闲话、一句棋谚掌故,别评具体某步:`
    } else if (target && this.deps.rng() < c.reactProb) {
      // 真互动(占比小):接某人的话,但要说到棋上,不空贫
      user = `「${target.name}」刚说:"${target.text}"。${len},接他的话——同意就补一刀、不同意就摆棋上的道理反驳他,像老熟人拌嘴但别空贫:`
      addressee = target.id
    } else if (stim.moveZh) {
      const depth = p.skill === 'weak'
        ? '你棋力一般,跟着感觉评,允许看走眼或说句外行话'
        : '你看得懂棋:点这步的得失/意图,对方该怎么应或下一步的威胁,能报个具体着法或变化更好'
      user = `第${stim.ply ?? '?'}手:${stim.moveZh},局面${qual}。${len}。${depth};用你的口吻,该损就损但要言之有物,不必每步都惊讶:`
    } else {
      user = `刚走了一步,局面${qual}。${len},随口说:`
    }

    return {
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: user },
      ],
      addressee,
    }
  }

  private recentMap(): Map<string, number> {
    const t = this.deps.now()
    const m = new Map<string, number>()
    for (const [id, ts] of this.lastSpokeAt) m.set(id, (t - ts) / 1000)
    return m
  }
}
