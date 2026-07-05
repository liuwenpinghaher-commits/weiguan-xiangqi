import type { LLMProvider } from '../llm/provider.js'
import type { MemoryStore } from '../memory/store.js'
import type { ChatLine, Stimulus, Persona, PersonaId, StimulusKind } from '../types.js'
import type { RuntimeConfig } from '../config/runtime-config.js'
import { viewScore } from '../personas/engine-view.js'
import { pickSpeakers } from './speaker-select.js'
import { TempoGuard } from './tempo.js'
import { buildNarrative, type ScoredMove } from './narrative.js'

export interface ChatEngineDeps {
  llm: LLMProvider
  mem: MemoryStore
  cfg: RuntimeConfig
  now: () => number
  emit: (line: ChatLine) => void
  rng: () => number
  /** 读历史着法评分,供叙事点评(局势总评/历史回顾)。 */
  repo: { getMoves: (gameId: number) => ScoredMove[] }
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

/**
 * 兜底清洗旁白/动作描写。prompt 已要求"不加旁白",但部分模型(尤其 DeepSeek v4-flash)
 * 爱加"（眯眼打量棋盘）""*抿一口二锅头*"这类角色扮演描写,不听 prompt。这里硬去掉——
 * 弹幕只保留角色说出口的话,动作既不显示也不进 TTS 朗读。
 */
function stripStageDirections(s: string): string {
  return s
    .replace(/[（(][^）)]*[）)]/g, '')   // 中/英文圆括号内的动作:（…）(…)
    .replace(/【[^】]*】/g, '')            // 方括号旁白:【…】
    .replace(/\*[^*]*\*/g, '')             // markdown 星号动作:*…*
    .replace(/\s{2,}/g, ' ')
    .trim()
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
  /** 按 gameId 缓存最近一次走子的局面上下文,供 idle 贴着局面说 */
  private lastCtx = new Map<number, { moveZh: string; qual: string; ply: number }>()
  /** 串行化 onStimulus:fire-and-forget 的刺激重叠时,保证同一时刻只处理一个,
   *  避免 lastSpokeAt/lastText 在 await llm 之后才更新导致并发读到旧态、同角色重复说话。 */
  private queue: Promise<void> = Promise.resolve()
  /** 高频刺激(逐手 move/blunder/brilliant)保留窗口大小:走快时最多滞后这么多步,超出丢最旧。 */
  private static readonly HIGH_FREQ_KEEP = 2
  private static readonly HIGH_FREQ_KINDS = new Set<StimulusKind>(['move', 'blunder', 'brilliant'])
  /** 按 gameId 的高频刺激待处理窗口(FIFO,最多 HIGH_FREQ_KEEP 条);其余刺激(转折/阶段/停顿等)
   *  不进此窗口、一律不丢——只有逐手级高频刺激才会因走子过快而被挤掉。 */
  private highFreqPending = new Map<number, Stimulus[]>()

  constructor(private deps: ChatEngineDeps) {
    this.guard = new TempoGuard({
      limits: () => { const c = deps.cfg.getChat(); return { minSilenceMs: c.minSilenceMs, maxPerMin: c.maxPerMin } },
      now: deps.now,
    })
  }

  /** 对局结束/清理时调用:丢弃该 gameId 的最近聊天缓冲与局面上下文,防按 gameId 累积的内存泄漏。 */
  forgetGame(gameId: number): void {
    this.recent.delete(gameId)
    this.lastCtx.delete(gameId)
    this.highFreqPending.delete(gameId)
  }

  /** 串行入口:把每个刺激挂到 queue 链尾,确保前一个处理完才开始下一个。
   *  await 它会等到「自己这条」处理结束(单刺激下与旧行为一致)。 */
  onStimulus(stim: Stimulus): Promise<void> {
    // 限积压丢旧,但只丢高频的:逐手 move/blunder/brilliant 按 gameId 保留最近 HIGH_FREQ_KEEP 条,
    // 超出丢最旧——走子快时中间步会被略过,语音不再一直补播上一步。turning_point/phase_shift/idle/
    // coach_query 等低频但重要的刺激不进这个窗口,一律不丢,保证转折/阶段/停顿类深度点评不漏。
    const isHighFreq = ChatEngine.HIGH_FREQ_KINDS.has(stim.kind)
    if (isHighFreq) {
      const win = this.highFreqPending.get(stim.gameId) ?? []
      win.push(stim)
      while (win.length > ChatEngine.HIGH_FREQ_KEEP) win.shift()
      this.highFreqPending.set(stim.gameId, win)
    }
    const run = this.queue.then(() => {
      if (isHighFreq) {
        const win = this.highFreqPending.get(stim.gameId)
        if (!win || !win.includes(stim)) return  // 已被后续走子挤出窗口 → 丢弃
        win.splice(win.indexOf(stim), 1)          // 出窗口,准备处理
      }
      return this.handleStimulus(stim)
    }).catch((err) => {
      console.warn('[chat] onStimulus 处理失败:', (err as Error).message)
    })
    // queue 只串行化、不在某条失败时断链(catch 已吞错)
    this.queue = run
    return run
  }

  private async handleStimulus(stim: Stimulus): Promise<void> {
    if (!this.guard.allow()) return
    if (stim.moveZh) {
      this.lastCtx.set(stim.gameId, { moveZh: stim.moveZh, qual: qualWord(stim.scoreCp ?? null), ply: stim.ply ?? 0 })
    }
    // turning_point/phase_shift 常紧跟在同一手的 move/blunder/brilliant 之后触发,而那条刺激
    // 可能已让多个旁观者刚发言。若仍套用最近发言惩罚,他们的分数会被打压到阈值以下,导致这类
    // 低频但重要的"关键时刻"反而选不出人、静默过去。故这两类刺激绕过惩罚(视为无人刚发言过)。
    const isKeyStim = stim.kind === 'turning_point' || stim.kind === 'phase_shift'
    const recentSecs = isKeyStim ? new Map<string, number>() : this.recentMap()
    const chat = this.deps.cfg.getChat()
    let speakers: PersonaId[]
    if (stim.kind === 'coach_query') {
      // 旁观让路:玩家提问只让教练结合棋局作答,不选其他旁观者、不让老黑插话
      const spectators = this.deps.cfg.personas().filter(p => !p.isPlayer)
      const coach = spectators.find(p => p.id === 'coach') ?? spectators[0]
      speakers = coach ? [coach.id] : []
    } else {
      const maxSpk = chat.maxSpeakers  // 每步发言人数(默认 1=只一个人说;控制台可调高)
      speakers = pickSpeakers(stim, this.deps.cfg.personas().filter(p => !p.isPlayer), recentSecs, this.deps.rng, chat.speakThreshold, chat.jitterWidth, maxSpk)
      // 老黑(AI 棋手)参与:自己刚走→高概率自评;其余有看头时→中概率作为当事人插话
      if (stim.byPlayerPersona) {
        if (this.deps.rng() < chat.playerSelfProb) speakers.push('player')
      } else if (this.deps.rng() < chat.playerChimeProb && (stim.moveZh != null || stim.kind === 'idle')) {
        speakers.push('player')
      }
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
        const raw = (await this.deps.llm.chat(plan.messages, {
          maxTokens: 100,  // 弹幕默认非思考;压到 100 杜绝长篇刷屏,一句话点评(引一典)足够
        })).trim()
        // 兜底清洗:模型(尤其 DeepSeek)不听 prompt 硬塞的"(动作)"旁白去掉——既不显示也不进 TTS
        const text = stripStageDirections(raw)
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

        // 先更新内存态(限流惩罚 + 上下文),再落库。落库属"尽力而为"的持久化,
        // 不能因其失败(检索/落库异常)而丢掉 lastSpokeAt/roundSoFar/recent——
        // 否则该 speaker 最近发言惩罚失效(可能连说)、同回合后续 speaker 看不到他这句。
        this.lastSpokeAt.set(id, this.deps.now())

        // 推入本回合已发言数组(供后续 speaker 看到)
        const entry: RecentEntry = { id, name: persona.name, text }
        roundSoFar.push(entry)

        // 推入全局 recent 缓冲(跨刺激记忆)
        this.pushRecent(stim.gameId, entry)

        // 落库单独兜底:失败只 warn,不抛——不影响上面的内存态与后续 speaker。
        try {
          await this.deps.mem.record({
            personaId: id,
            kind: 'episode',
            content: text,
            importance: 1,
            gameId: stim.gameId,
            createdAt: line.ts,
          })
        } catch (err) {
          console.warn('[chat] 记忆落库失败:', (err as Error).message)
        }
      } catch (err) {
        // 单个 speaker 生成失败:跳过该 speaker,不影响其他人。
        // 用 warn 记录而非静默吞——否则故障(如 LLM/记忆异常)无从排查。
        console.warn('[chat] speaker', id, '生成失败,跳过:', (err as Error).message)
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
    const narrative = buildNarrative(this.deps.repo.getMoves(stim.gameId))

    // 记忆检索只是辅助背景("你对这位棋手的了解");检索失败(嵌入异常等)
    // 必须降级为"还不了解",绝不能抛错——否则会被外层 per-speaker catch 吞掉,导致全场哑火。
    let facts = '(还不了解)'
    try {
      const mems = await this.deps.mem.retrieve(p.id, stim.moveZh ?? stim.humanText ?? stim.kind, 3, ['fact', 'insight'])
      if (mems.length) facts = mems.map(m => '· ' + m.content).join('\n')
    } catch (err) {
      console.warn('[chat] 记忆检索失败,降级为无背景:', (err as Error).message)
    }

    const contextLine = context.length > 0
      ? context.map(c => `- ${c.name}:${c.text}`).join('\n')
      : '(刚开局,还没人说话)'

    // 阶段词进 prompt:开/中/残局的谈资口味不同(残局理路/开局套路)——消费 Stimulus.phase
    const phaseWord = stim.phase === 'opening' ? '开局' : stim.phase === 'endgame' ? '残局' : stim.phase === 'midgame' ? '中盘' : ''
    const phaseHint = phaseWord ? `现在是${phaseWord}阶段。` : ''
    const sys = `你是「${p.name}」。${p.background}\n说话像:${p.voice} 立场:${p.leaning}\n${phaseHint}`
      + `你是懂棋的行家,在旁**点评这盘棋**。每句都要落到棋上,把这步说透:好在哪/坏在哪、真实意图、对方该怎么应、有什么威胁、背后的棋理路数。\n`
      + `- **多引经据典**:结合眼前这步,恰当引用象棋术语与套路(当头炮、屏风马、仙人指路、马后炮、士角炮、弃子抢先…)、棋谚("宁失一子不失一先""马走日、象走田""一车十子寒""小卒过河当小车""得势不饶人"…)、经典布局理路或名家棋理,让点评有底蕴;但典故须真实、紧扣当前局面,拿不准就用通用棋理,别瞎编具体名局年份。\n`
      + `- 内容一律围绕棋,别扯场外闲话、别纯拌嘴起哄;保留你的人设口吻(${p.voice}),但要言之有物。\n`
      + `- 按棋力说话:看得准就点到要害、敢报具体着法或变化;棋力次的也要围绕这步说,可看走眼但别离题。\n`
      + `- 长短随内容:点要害可短("这手软了,丢了先手"),讲道理或引典故时把话说完整,别每句一个调。\n`
      + `只输出你说的那一句话,不带引号、不加旁白、不写名字前缀。\n`
      + `你对这位棋手的了解:\n${facts}\n`
      + `刚才这桌在聊(要接就接到棋上,别空贫):\n${contextLine}`
      + (p.id === 'coach' ? '你尤其擅长通盘局势总评与战略方向。\n'
       : p.id === 'laopaoer' ? '你见多识广,尤其爱结合掌故、名局、往手回顾来点评。\n'
       : '')

    // 长度风格:多数偏短,制造节奏
    const lr = this.deps.rng()
    const len = lr < c.lenShortP ? '就两三个字或半句' : lr < c.lenLongP ? '一句话' : '一句话,可稍长但别啰嗦'

    // react 目标:最近一条不是自己说的
    const target = [...context].reverse().find(c => c.id !== p.id)

    let user: string
    let addressee: ChatLine['addressee'] = 'all'
    if (p.isPlayer && stim.byPlayerPersona) {
      user = `你(${p.name})刚走了「${stim.moveZh ?? '一步'}」,局面${qual}。自评一句:说说你这步的算计或得失,别空吹,${len}:`
    } else if (p.isPlayer) {
      const pctx = this.lastCtx.get(stim.gameId)
      const psit = pctx ? `眼下「${pctx.moveZh}」,${pctx.qual}` : `局面${qual}`
      user = `你是正在下这盘的老黑,沉稳、闷、偶尔得意,这是你的对局、有立场。${psit}。${len},就眼前局面/对手这步/接刚才那句说一句,带你的脾气,别长篇:`
    } else if (stim.kind === 'coach_query') {
      const ei = stim.engineInsight
      const mateStr = ei && ei.mate != null
        ? (ei.mate > 0 ? `;红方有${ei.mate}步杀` : `;黑方有${-ei.mate}步杀`)
        : ''
      const insightLine = ei
        ? `引擎判断:${qualWord(ei.evalCp)}(红方${ei.evalCp ?? '?'}分)`
          + (ei.bestMoveZh ? `,最佳应着「${ei.bestMoveZh}」` : '')
          + (ei.pvZh.length ? `,后续「${ei.pvZh.join('、')}」` : '')
          + mateStr + '。'
        : '(引擎暂不可用,凭你的棋力判断。)'
      user = `棋手问你:"${stim.humanText}"。${insightLine}结合眼前局面针对性回答他的问题,专业、有据、口语,别长篇,可引一句棋理:`
      addressee = 'human'
    } else if (stim.kind === 'long_think') {
      user = `对方这步想了很久还没落子。${len},用你的脾气随口催两句/调侃/安慰,别太冲:`
    } else if (stim.kind === 'turning_point') {
      user = `局面刚发生转折——第${stim.ply ?? '?'}手${stim.moveZh ?? ''}后,${qual}。${len}。`
        + `点出这个转折:攻守易势在哪、谁抓住了机会、回看前面哪步埋的因;${narrative ? `叙事参考:${narrative}。` : ''}引一句棋谚/棋理,用你的口吻:`
    } else if (stim.kind === 'phase_shift') {
      const pw = stim.phase === 'endgame' ? '残局' : stim.phase === 'midgame' ? '中盘' : '开局'
      user = `棋局进入${pw}。${len}。做个局势总评:盘面性质、谁占主动、双方战略方向;${narrative ? `参考走势:${narrative}。` : ''}引经据典,别流水账:`
    } else if (stim.kind === 'idle' || (stim.kind === 'topic_open' && !stim.moveZh)) {
      const dim = this.deps.rng()
      const ictx = this.lastCtx.get(stim.gameId)
      const sit = ictx ? `眼下第${ictx.ply}手「${ictx.moveZh}」,${ictx.qual}` : '这局还在走'
      if (dim < 0.34) {
        user = `这会儿没新棋步。${len}。做个局势总评(${sit}):谁占优、局面性质、下一阶段该往哪使劲;${narrative ? `走势:${narrative}。` : ''}引经据典别空谈:`
      } else if (dim < 0.67 && narrative) {
        user = `这会儿没新棋步。${len}。回看这盘的走势(${narrative}):哪步是转折、当时的伏笔现在兑现没、棋手这盘的路子;用你的口吻带点掌故:`
      } else {
        user = `这会儿没新棋步。${len}。展望一下(${sit}):双方接下来的计划、有什么威胁或杀着苗头、该防哪一手;引一句棋理,别瞎猜:`
      }
    } else if (target && this.deps.rng() < c.reactProb) {
      // 真互动(占比小):接某人的话,但要说到棋上,不空贫
      user = `「${target.name}」刚说:"${target.text}"。${len},接他的话——同意就补一刀、不同意就摆棋上的道理反驳他,像老熟人拌嘴但别空贫:`
      addressee = target.id
    } else if (stim.moveZh) {
      const depth = p.skill === 'weak'
        ? '你棋力一般,围绕这步说你的看法,可看走眼但别离题'
        : '你看得懂棋:点这步的得失/意图,对方该怎么应或下一步的威胁,能报具体着法或变化更好'
      user = `第${stim.ply ?? '?'}手:${stim.moveZh},局面${qual}。${len}。${depth};**尽量引一句扣着此局面的棋谚/术语/棋理**,用你的口吻点评,言之有物:`
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
