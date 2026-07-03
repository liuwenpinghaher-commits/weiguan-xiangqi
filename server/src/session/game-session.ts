import type { GamesRepo } from '../store/games-repo.js'
import type { EngineLine, GameMode, Side, DirectorContext, Stimulus } from '../types.js'
import { selectMove } from '../director/director.js'
import { describeMoveZh } from '../rules/describe-move.js'
import { computePlayerState } from './player-state.js'
import { adjudicate } from '../rules/adjudicate.js'
import type { RepeatInfo } from '../rules/adjudicate.js'
import { classifyMoveKind, baseTensionForKind } from './stimulus-kind.js'
import type { RuntimeConfig } from '../config/runtime-config.js'

interface PositionLike {
  fen(): string
  sideToMove(): Side
  legalMoves(): string[]
  applyMove(move: string): PositionLike
  isGameOver(): { over: boolean; result?: Side | 'draw' }
  /** 可选：局面去重键（三次重复检测用）。fakePosition 可能缺失。*/
  key?(): string
  /** 可选：当前走子方是否被将军。fakePosition 可能缺失。*/
  inCheck?(): boolean
}

/**
 * 计算 FEN 棋盘段中的棋子数（字母数量）。
 * 用于判断是否发生吃子（走前棋子数 > 走后棋子数）。
 */
function pieceCount(fen: string): number {
  const board = fen.split(' ')[0]
  return (board.match(/[a-zA-Z]/g) ?? []).length
}

/**
 * 安全提取局面 key（能力检测，fakePosition 不支持时返回 null）。
 */
function safeKey(pos: PositionLike): string | null {
  try {
    return typeof pos.key === 'function' ? pos.key() : null
  } catch {
    return null
  }
}

/**
 * 安全提取走子方是否被将军（能力检测，fakePosition 不支持时返回 false）。
 */
function safeInCheck(pos: PositionLike): boolean {
  try {
    return typeof pos.inCheck === 'function' ? pos.inCheck() : false
  } catch {
    return false
  }
}
interface EngineLike { analyze(fen: string, opts: { multipv: number; movetime?: number }): Promise<EngineLine[]> }

export interface GameSessionDeps {
  repo: GamesRepo
  engine: EngineLike
  makePosition: (fen: string) => PositionLike
  clock: () => string
  cfg: RuntimeConfig
  /** 可选:走子后触发聊天刺激 */
  onStimulus?: (s: Stimulus) => void
}

/** 根据手数推断对局阶段 */
function calcPhase(ply: number): 'opening' | 'midgame' | 'endgame' {
  if (ply <= 16) return 'opening'
  if (ply <= 60) return 'midgame'
  return 'endgame'
}

/** 安全调用 describeMoveZh,失败返回 undefined(保护假局面/异常不破坏主流程) */
function safeDescribeMove(fenBefore: string, move: string): string | undefined {
  try {
    return describeMoveZh(fenBefore, move)
  } catch {
    return undefined
  }
}

export class GameSession {
  private positions = new Map<number, PositionLike>()
  private modes = new Map<number, GameMode>()
  private humanSides = new Map<number, Side>()
  /** 每局最近一次人类走子的时间戳(毫秒),NaN clock 时不更新 */
  private lastMoveAt = new Map<number, number>()
  /** 每局最近一次人类走子的用时(毫秒),0 表示未知 */
  private lastMoveMs = new Map<number, number>()
  /** 三次重复/长将裁决：每局的局面历史（含初始局面） */
  private repeatHistories = new Map<number, RepeatInfo[]>()
  /** 三次重复/60回合裁决：每局自上次吃子以来的半步数 */
  private noCapturePlies = new Map<number, number>()
  /**
   * 每局上一手"红方视角评分"（厘兵分）。
   * 用于计算评分摆幅（swing），支持 blunder/brilliant 分类。
   * key=gameId, value=上一手落定后的红方 cp；null 表示尚无前手评分。
   */
  private prevRedCp = new Map<number, number | null>()
  /**
   * 上一手人方是否走出 blunder（供导演决策用）。
   * key=gameId, value=true/false。
   */
  private lastHumanBlunder = new Map<number, boolean>()
  private clockStates = new Map<number, { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null; startedAt: number | null }>()
  /** 每局已用悔棋次数(服务端权威;前端 undoRemaining 仅展示) */
  private undoCounts = new Map<number, number>()

  constructor(private deps: GameSessionDeps) {}

  /** 结算当前走钟一方的耗时(含增秒);startedAt=null(暂停/未启动)时为空操作。 */
  private settleActive(clock: { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null; startedAt: number | null }, withIncrement: boolean): void {
    if (clock.activeSide === null || clock.startedAt === null) return
    const elapsed = Date.now() - clock.startedAt
    if (clock.activeSide === 'red') clock.redRemaining = Math.max(0, clock.redRemaining - elapsed)
    else clock.blackRemaining = Math.max(0, clock.blackRemaining - elapsed)
    if (withIncrement) {
      const inc = this.deps.cfg.getEngineParams().clockIncrementSeconds * 1000
      if (clock.activeSide === 'red') clock.redRemaining += inc
      else clock.blackRemaining += inc
    }
    clock.activeSide = null
    clock.startedAt = null
  }

  private startClockFor(clock: { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null; startedAt: number | null }, side: Side): void {
    clock.activeSide = side
    clock.startedAt = Date.now()
  }

  /**
   * 超时判负检查:当前走钟方剩余时间归零 → 判对方胜并 finish。
   * 由 ws-server 定时清扫器与走子入口调用;无钟/未走钟/未超时返回 null。
   */
  checkTimeout(gameId: number): { over: true; result: Side; fen: string } | null {
    const clock = this.clockStates.get(gameId)
    if (!clock || clock.activeSide === null || clock.startedAt === null) return null
    const elapsed = Date.now() - clock.startedAt
    const remaining = clock.activeSide === 'red' ? clock.redRemaining - elapsed : clock.blackRemaining - elapsed
    if (remaining > 0) return null
    const loser = clock.activeSide
    const winner: Side = loser === 'red' ? 'black' : 'red'
    this.ensureLoaded(gameId)
    const pos = this.positions.get(gameId)
    const fen = pos ? pos.fen() : ''
    this.finish(gameId, winner)
    return { over: true, result: winner, fen }
  }

  /**
   * 若 positions Map 里没有 gameId，从 DB 重建内存态（续局支持）。
   * - 从 repo.getGame 取局信息；无 → 维持原 'game not found' 语义（不抛，让调用方抛）。
   * - 用 makePosition(startFen) 起始，按 getMoves 顺序逐步 applyMove 重放。
   * - 同步重建 modes、humanSides、repeatHistories、noCapturePlies。
   * - lastMoveAt 不恢复（置 0，对续局张力检测无影响）。
   */
  private ensureLoaded(gameId: number): void {
    if (this.positions.has(gameId)) return

    const g = this.deps.repo.getGame(gameId)
    if (!g) return  // 调用方的 positions.get 会返回 undefined，由调用方抛 'game not found'

    this.rebuildDerivedState(gameId, g.startFen)
    this.modes.set(gameId, g.mode)
    this.humanSides.set(gameId, g.humanSide)

    // 时钟不落库:续局/重启后按配置重建全新钟(重启=时间重置,注释明示该取舍)。
    if (!this.clockStates.has(gameId) && !g.result) {
      const engineCfg = this.deps.cfg.getEngineParams()
      this.clockStates.set(gameId, {
        redRemaining: engineCfg.clockInitialSeconds * 1000,
        blackRemaining: engineCfg.clockInitialSeconds * 1000,
        activeSide: null,
        startedAt: null,
      })
    }
  }

  /**
   * 由 startFen + DB moves 重放,重建 positions/repeatHistories/noCapturePlies。
   * ensureLoaded(续局)与 undoLastMoves(悔棋后回滚裁决状态)共用,保证两处推导一致。
   */
  private rebuildDerivedState(gameId: number, startFen: string): void {
    let pos = this.deps.makePosition(startFen)
    const moves = this.deps.repo.getMoves(gameId)

    const startKey = safeKey(pos)
    const repeatHistory: RepeatInfo[] = []
    if (startKey !== null) {
      const startInCheck = safeInCheck(pos)
      const side = pos.sideToMove()
      repeatHistory.push({
        key: startKey,
        redChecked: side === 'red' ? startInCheck : false,
        blackChecked: side === 'black' ? startInCheck : false,
      })
    }
    let noCapture = 0

    for (const m of moves) {
      const before = pos
      pos = pos.applyMove(m.move)

      if (repeatHistory.length > 0) {
        const afterKey = safeKey(pos)
        if (afterKey !== null) {
          const afterInCheck = safeInCheck(pos)
          const moveSide = m.side
          repeatHistory.push({
            key: afterKey,
            redChecked: moveSide === 'red' ? afterInCheck : false,
            blackChecked: moveSide === 'black' ? afterInCheck : false,
          })
        }
      }

      const captured = pieceCount(before.fen()) > pieceCount(pos.fen())
      noCapture = captured ? 0 : noCapture + 1
    }

    this.positions.set(gameId, pos)
    this.repeatHistories.set(gameId, repeatHistory)
    this.noCapturePlies.set(gameId, noCapture)
  }

  newGame(g: { mode: GameMode; humanSide: Side; startFen: string }): number {
    // 先解析后落库:非法 startFen 在此抛出,不产生无着法的孤儿 games 行
    const startPos = this.deps.makePosition(g.startFen)
    const id = this.deps.repo.createGame({ ...g, startedAt: this.deps.clock() })
    this.positions.set(id, startPos)
    this.modes.set(id, g.mode)
    this.humanSides.set(id, g.humanSide)

    // 初始化重复局面历史：记录初始局面（key 能力检测，fakePosition 缺方法时跳过）
    const startKey = safeKey(startPos)
    if (startKey !== null) {
      // 初始局面：走子方 inCheck 记录（初始一般不被将）
      const startInCheck = safeInCheck(startPos)
      const side = startPos.sideToMove()
      const initialInfo: RepeatInfo = {
        key: startKey,
        redChecked: side === 'red' ? startInCheck : false,
        blackChecked: side === 'black' ? startInCheck : false,
      }
      this.repeatHistories.set(id, [initialInfo])
    } else {
      // fakePosition 缺 key()，跳过重复裁决
      this.repeatHistories.set(id, [])
    }
    this.noCapturePlies.set(id, 0)
    const engineCfg = this.deps.cfg.getEngineParams()
    this.clockStates.set(id, {
      redRemaining: engineCfg.clockInitialSeconds * 1000,
      blackRemaining: engineCfg.clockInitialSeconds * 1000,
      activeSide: null,
      startedAt: null,
    })

    return id
  }

  /** 该局是否已终局(DB 有 result)。完局后 finish 已删净内存态,ensureLoaded 会从 DB
   *  重建可下局面——若不拦,超时/认负/和棋后到达的 move/undo 会"复活"已结束的局、追加脏着法。 */
  private isFinished(gameId: number): boolean {
    return !!this.deps.repo.getGame(gameId)?.result
  }

  async playHumanMove(gameId: number, move: string): Promise<{ aiMove: string | null; fen: string; over: boolean; result?: 'red' | 'black' | 'draw'; aiReason?: string }> {
    // 完局守卫:对局已判负/和/超时后,拒绝任何后续走子(防复活僵尸局、写终局后脏着法)
    if (this.isFinished(gameId)) throw new Error('对局已结束')
    // 走子前先查超时:读秒已归零则直接判负(flag-fall),不再受理这手棋
    const timedOut = this.checkTimeout(gameId)
    if (timedOut) return { aiMove: null, ...timedOut }
    const clock = this.clockStates.get(gameId)
    if (clock) this.settleActive(clock, true)
    this.ensureLoaded(gameId)
    const pos = this.positions.get(gameId)
    if (!pos) throw new Error('game not found')

    // 守卫:仅允许 human 一方在轮到自己时走子(不写库、不改状态)
    const humanSide = this.humanSides.get(gameId)!
    const humanTurn = pos.sideToMove()
    if (humanTurn !== humanSide) throw new Error(`not your turn: side to move is ${humanTurn}, human is ${humanSide}`)

    // 1. 校验人着合法(非法则抛,不写库不改状态)
    if (!pos.legalMoves().includes(move)) throw new Error(`illegal move: ${move}`)

    // 记录本次人着时间戳并计算用时(NaN clock 时忽略,防假 clock 破坏状态)
    const nowMs = Date.parse(this.deps.clock())
    if (!Number.isNaN(nowMs)) {
      const prev = this.lastMoveAt.get(gameId)
      this.lastMoveMs.set(gameId, prev !== undefined ? nowMs - prev : 0)
      this.lastMoveAt.set(gameId, nowMs)
    }

    // 2. 纯计算人着后的局面(暂不落库、不 set)
    const beforeFen = pos.fen()
    const humanZh = safeDescribeMove(beforeFen, move)
    const afterHuman = pos.applyMove(move)

    // 3. 人着已直接终局:写人着 → finish → set,返回
    //    同时检查重复裁决（isGameOver 检将死/困毙，repeatCheck 检三次重复/60回合）
    const humanOver = afterHuman.isGameOver()
    const humanRepeat = this.checkRepeatAdjudicate(gameId, pos, humanTurn, afterHuman)
    if (humanOver.over || humanRepeat !== null) {
      this.deps.repo.addMove({ gameId, side: humanTurn, move, fenAfter: afterHuman.fen(), scoreCp: null, byAi: false })
      this.positions.set(gameId, afterHuman)
      this.applyRepeatState(gameId, pos, humanTurn, afterHuman)
      const result = humanOver.over ? humanOver.result! : humanRepeat!.result
      this.finish(gameId, result)
      const humanPly = this.deps.repo.getMoves(gameId).length
      const phase = calcPhase(humanPly)
      const endHumanLastMs = this.lastMoveMs.get(gameId) ?? 0
      const isEndCapture = humanZh?.includes('吃') ?? false
      const endHumanKind = classifyMoveKind(0, isEndCapture, endHumanLastMs)
      const endBaseTension = baseTensionForKind(endHumanKind)
      const endTension = isEndCapture && endHumanKind === 'move'
        ? Math.max(endBaseTension, 0.9)
        : endBaseTension
      this.deps.onStimulus?.({
        kind: endHumanKind, gameId, scoreCp: null,
        moveZh: humanZh, side: humanTurn, ply: humanPly, phase,
        tension: endTension,
      })
      return { aiMove: null, fen: afterHuman.fen(), over: true, result }
    }

    // 4. 计算 AI 回着(此处任何失败都抛出,且尚未写任何库、未改 position,可重试)
    //    AI 一侧按真实计算耗时走钟(诚实计时,不再恒为初始值)
    const aiThinkingSide = afterHuman.sideToMove()
    if (clock) this.startClockFor(clock, aiThinkingSide)
    const ep = this.deps.cfg.getEngineParams()
    let lines
    try {
      lines = await this.deps.engine.analyze(afterHuman.fen(), { multipv: ep.multipv, movetime: ep.movetime })
    } finally {
      if (clock) this.settleActive(clock, true)
    }
    // 完局二次守卫:analyze 是唯一 await 点,期间 sweeper 可能因 AI 侧超时 finish 并删净内存态。
    // 若已终局则中止,不把这手写进已结束的对局(也避免 applyRepeatState 读到已删的 repeatHistories)。
    if (this.isFinished(gameId)) throw new Error('对局已结束')
    const ctx = this.buildContext(gameId)
    const decision = selectMove(lines, ctx)
    const aiSide = afterHuman.sideToMove()
    const aiBeforeFen = afterHuman.fen()
    const aiZh = safeDescribeMove(aiBeforeFen, decision.move)
    const afterAI = afterHuman.applyMove(decision.move)

    // 5. 全部成功:一次性写人着、AI 着,set position 为 afterAI,判终局
    this.deps.repo.addMove({ gameId, side: humanTurn, move, fenAfter: afterHuman.fen(), scoreCp: null, byAi: false })
    this.deps.repo.addMove({ gameId, side: aiSide, move: decision.move, fenAfter: afterAI.fen(), scoreCp: decision.chosenLine.scoreCp, byAi: true })
    this.positions.set(gameId, afterAI)

    // 更新人着的重复历史（人着确定落地后才更新状态）
    this.applyRepeatState(gameId, pos, humanTurn, afterHuman)

    const allMoves = this.deps.repo.getMoves(gameId)
    const humanPly = allMoves.length - 1  // 人着是倒数第二
    const aiPly = allMoves.length          // AI 着是最后一条
    const humanPhase = calcPhase(humanPly)
    const aiPhase = calcPhase(aiPly)

    // ── 评分摆幅计算 ──────────────────────────────────────────────────────────
    // AI 着完成后，得到本手红方视角评分
    const aiCp = decision.chosenLine.scoreCp
    const redCp = aiSide === 'red' ? aiCp : -aiCp

    // 计算 AI 着的 swing（走子方=AI 视角）：redCp 对 AI 的意义
    //   若 AI 是红方：swing = redCp - prevRedCp（对红有利为正即对 AI 有利）
    //   若 AI 是黑方：swing = -(redCp - prevRedCp)（红方优势减少 = 黑方增益）
    const prev = this.prevRedCp.get(gameId) ?? null
    let aiSwing: number | null = null
    if (prev !== null) {
      const deltaRed = redCp - prev
      aiSwing = aiSide === 'red' ? deltaRed : -deltaRed
    }

    // 更新 prevRedCp（以本手 AI 结束后的红方 cp 为准）
    this.prevRedCp.set(gameId, redCp)

    // 人着刺激：结合 swing（此时人着尚无引擎 cp，用 null swing 降级为 long_think/move）
    const humanLastMs = this.lastMoveMs.get(gameId) ?? 0
    const isHumanCapture = humanZh?.includes('吃') ?? false
    // 人着暂无精确 swing（需要人着前后引擎评分，当前仅 AI 着后才有评分）
    // 因此人着 kind 仍用 lastMoveMs 判断，AI 着 kind 用 aiSwing
    const humanKind = classifyMoveKind(0, isHumanCapture, humanLastMs)
    const humanBaseTension = baseTensionForKind(humanKind)
    const humanTension = isHumanCapture && humanKind === 'move'
      ? Math.max(humanBaseTension, 0.9)
      : humanBaseTension
    this.deps.onStimulus?.({
      kind: humanKind, gameId, scoreCp: null,
      moveZh: humanZh, side: humanTurn, ply: humanPly, phase: humanPhase,
      tension: humanTension,
    })

    // AI 着刺激：用 aiSwing 分类（无 prev 时降级为 move）
    const isAiCapture = aiZh?.includes('吃') ?? false
    const aiSwingVal = aiSwing ?? 0
    const aiKind = aiSwing !== null
      ? classifyMoveKind(aiSwingVal, isAiCapture, 0)
      : 'move'
    const aiBaseTension = baseTensionForKind(aiKind)
    const aiTension = isAiCapture && aiKind === 'move'
      ? Math.max(aiBaseTension, 0.9)
      : aiBaseTension
    this.deps.onStimulus?.({
      kind: aiKind, gameId, scoreCp: redCp,
      moveZh: aiZh, side: aiSide, ply: aiPly, phase: aiPhase,
      tension: aiTension,
      byPlayerPersona: true,
    })

    // 更新人方是否 blunder（用 aiSwing 反推：AI 走完后 swing 极正 = 对 AI 有利 = 人方走坏了）
    // 换言之：若 aiSwing >= 150（AI 捡到大便宜），说明人方上一手走出 blunder
    this.lastHumanBlunder.set(gameId, aiSwing !== null && aiSwing >= 150)

    // AI 着终局判定：isGameOver（将死/困毙）与重复裁决并存
    const aiOver = afterAI.isGameOver()
    const aiRepeat = this.checkRepeatAdjudicate(gameId, afterHuman, aiSide, afterAI)
    this.applyRepeatState(gameId, afterHuman, aiSide, afterAI)
    if (aiOver.over || aiRepeat !== null) {
      const result = aiOver.over ? aiOver.result! : aiRepeat!.result
      this.finish(gameId, result)
      return { aiMove: decision.move, fen: afterAI.fen(), over: true, result, aiReason: decision.reason }
    }
    if (clock) this.startClockFor(clock, this.humanSides.get(gameId)!)
    return { aiMove: decision.move, fen: afterAI.fen(), over: false, aiReason: decision.reason }
  }

  /**
   * AI 主动走一手（用于 humanSide='black' 时开局 AI 先手）。
   * - ensureLoaded 保证内存态已就绪。
   * - 若当前走子方 === humanSide（轮到人走），抛出 "not AI turn"。
   * - 否则用引擎分析当前局面，selectMove 选手，applyMove 落子，入库 by_ai。
   * - 触发 byPlayerPersona 刺激（与 playHumanMove AI 段一致）。
   * - 返回 { aiMove, fen, over, result? }。
   */
  async aiFirstMove(gameId: number): Promise<{ aiMove: string; fen: string; over: boolean; result?: 'red' | 'black' | 'draw'; aiReason?: string }> {
    if (this.isFinished(gameId)) throw new Error('对局已结束')
    this.ensureLoaded(gameId)
    const pos = this.positions.get(gameId)
    if (!pos) throw new Error('game not found')

    const humanSide = this.humanSides.get(gameId)!
    const currentSide = pos.sideToMove()
    if (currentSide === humanSide) {
      throw new Error(`not AI turn: side to move is ${currentSide}, human is ${humanSide}`)
    }

    // 引擎分析当前局面,AI 走一手(AI 侧真实走钟)
    const clock = this.clockStates.get(gameId)
    if (clock) this.startClockFor(clock, currentSide)
    const ep = this.deps.cfg.getEngineParams()
    let lines
    try {
      lines = await this.deps.engine.analyze(pos.fen(), { multipv: ep.multipv, movetime: ep.movetime })
    } finally {
      if (clock) this.settleActive(clock, true)
    }
    const ctx = this.buildContext(gameId)
    const decision = selectMove(lines, ctx)
    const aiSide = currentSide
    const aiBeforeFen = pos.fen()
    const aiZh = safeDescribeMove(aiBeforeFen, decision.move)
    const afterAI = pos.applyMove(decision.move)

    // 入库
    this.deps.repo.addMove({
      gameId,
      side: aiSide,
      move: decision.move,
      fenAfter: afterAI.fen(),
      scoreCp: decision.chosenLine.scoreCp,
      byAi: true,
    })
    this.positions.set(gameId, afterAI)

    // 更新重复历史
    this.applyRepeatState(gameId, pos, aiSide, afterAI)

    // 刺激（byPlayerPersona，与 playHumanMove AI 段一致）
    const allMoves = this.deps.repo.getMoves(gameId)
    const aiPly = allMoves.length
    const aiPhase = calcPhase(aiPly)
    const aiCp = decision.chosenLine.scoreCp
    const redCp = aiSide === 'red' ? aiCp : -aiCp
    const aiBase = Math.max(0.5, Math.min(1, Math.abs(aiCp) / 300))
    const aiTension = aiZh?.includes('吃') ? Math.max(aiBase, 0.9) : aiBase
    this.deps.onStimulus?.({
      kind: 'move', gameId, scoreCp: redCp,
      moveZh: aiZh, side: aiSide, ply: aiPly, phase: aiPhase,
      tension: aiTension,
      byPlayerPersona: true,
    })

    // 终局判定
    const aiOver = afterAI.isGameOver()
    const aiRepeat = this.checkRepeatAdjudicate(gameId, pos, aiSide, afterAI)
    // applyRepeatState 已在上方调用，此处仅处理终局写库
    if (aiOver.over || aiRepeat !== null) {
      const result = aiOver.over ? aiOver.result! : aiRepeat!.result
      this.finish(gameId, result)
      return { aiMove: decision.move, fen: afterAI.fen(), over: true, result, aiReason: decision.reason }
    }

    // AI 先手落定后轮到人类,人类开始走钟
    if (clock) this.startClockFor(clock, humanSide)
    return { aiMove: decision.move, fen: afterAI.fen(), over: false, aiReason: decision.reason }
  }

  private buildContext(gameId: number): DirectorContext {
    const mode = this.modes.get(gameId)!
    const recent = this.deps.repo.recentResults(10)  // 按各局自身 human_side 映射,无需传入
    const lastMoveMs = this.lastMoveMs.get(gameId) ?? 0
    const recentBlunder = this.lastHumanBlunder.get(gameId) ?? false
    const playerState = computePlayerState(recent, lastMoveMs, recentBlunder)
    const d = this.deps.cfg.getDirectorDefaults()[mode === 'humanlike' ? 'humanlike' : 'coach']
    return {
      mode,
      playerState,
      maxDropCp: d.maxDropCp,
      targetBand: d.targetBand,
      strength: d.strength,
      rng: Math.random,
    }
  }

  /**
   * 纯查询：根据走子前局面、走子方、走子后局面，判断是否触发重复裁决。
   * 不修改任何状态（调用前 history 尚未更新）。
   * 若 pos 不支持 key()，直接返回 null（fakePosition 兼容）。
   */
  private checkRepeatAdjudicate(
    gameId: number,
    before: PositionLike,
    side: Side,
    after: PositionLike,
  ): { result: 'red' | 'black' | 'draw' } | null {
    const history = this.repeatHistories.get(gameId)!
    // fakePosition 没有 key()：history 为空，跳过
    if (history.length === 0) return null
    const afterKey = safeKey(after)
    if (afterKey === null) return null

    // 走后局面走子方是否被将（即刚走那步是否将军了对方）
    const afterInCheck = safeInCheck(after)
    const newInfo: RepeatInfo = {
      key: afterKey,
      redChecked: side === 'red' ? afterInCheck : false,
      blackChecked: side === 'black' ? afterInCheck : false,
    }

    // 是否吃子：走前棋子数 > 走后棋子数
    const captured = pieceCount(before.fen()) > pieceCount(after.fen())
    const currentNoCapture = this.noCapturePlies.get(gameId)!
    const nextNoCapture = captured ? 0 : currentNoCapture + 1

    // 用临时 history 判定（不 mutate 状态）
    return adjudicate([...history, newInfo], nextNoCapture)
  }

  /**
   * 在走子确定落地后，将新 RepeatInfo 推入历史并更新无吃子计数。
   * 必须在 checkRepeatAdjudicate 之后调用（状态在此更新）。
   */
  private applyRepeatState(
    gameId: number,
    before: PositionLike,
    side: Side,
    after: PositionLike,
  ): void {
    const history = this.repeatHistories.get(gameId)!
    if (history.length === 0) return  // fakePosition，跳过
    const afterKey = safeKey(after)
    if (afterKey === null) return

    const afterInCheck = safeInCheck(after)
    const newInfo: RepeatInfo = {
      key: afterKey,
      redChecked: side === 'red' ? afterInCheck : false,
      blackChecked: side === 'black' ? afterInCheck : false,
    }
    history.push(newInfo)

    const captured = pieceCount(before.fen()) > pieceCount(after.fen())
    const currentNoCapture = this.noCapturePlies.get(gameId)!
    this.noCapturePlies.set(gameId, captured ? 0 : currentNoCapture + 1)
  }

  /** 测试/诊断用只读探针:该 gameId 是否仍持有任一内存态条目(finish 后应全清)。 */
  hasGameState(gameId: number): boolean {
    return this.positions.has(gameId) || this.modes.has(gameId) || this.humanSides.has(gameId)
      || this.lastMoveAt.has(gameId) || this.lastMoveMs.has(gameId)
      || this.repeatHistories.has(gameId) || this.noCapturePlies.has(gameId)
      || this.prevRedCp.has(gameId) || this.lastHumanBlunder.has(gameId)
      || this.clockStates.has(gameId) || this.undoCounts.has(gameId)
  }

  getClockState(gameId: number) {
    const clock = this.clockStates.get(gameId)
    if (!clock) return null
    let red = clock.redRemaining
    let black = clock.blackRemaining
    if (clock.activeSide === 'red' && clock.startedAt !== null) {
      red = Math.max(0, red - (Date.now() - clock.startedAt))
    } else if (clock.activeSide === 'black' && clock.startedAt !== null) {
      black = Math.max(0, black - (Date.now() - clock.startedAt))
    }
    return { redRemaining: red, blackRemaining: black, activeSide: clock.activeSide }
  }

  /** 暂停走钟:结算已耗时(不加增秒),保留 activeSide、冻结计时。WS pause 分支调用。 */
  pauseClock(gameId: number): void {
    const clock = this.clockStates.get(gameId)
    if (!clock || clock.activeSide === null || clock.startedAt === null) return
    const elapsed = Date.now() - clock.startedAt
    if (clock.activeSide === 'red') clock.redRemaining = Math.max(0, clock.redRemaining - elapsed)
    else clock.blackRemaining = Math.max(0, clock.blackRemaining - elapsed)
    clock.startedAt = null  // activeSide 保留 → resume 知道该给谁重新起钟
  }

  /** 恢复走钟:pause 冻结的一方从当前时刻继续计时。WS resume 分支调用。 */
  resumeClock(gameId: number): void {
    const clock = this.clockStates.get(gameId)
    if (!clock || clock.activeSide === null || clock.startedAt !== null) return
    clock.startedAt = Date.now()
  }

  /** 公开只读取 fen，避免调用方穿透私有 positions（不存在时返回空串）。 */
  getFen(gameId: number): string {
    this.ensureLoaded(gameId)
    const pos = this.positions.get(gameId)
    return pos ? pos.fen() : ''
  }

  resign(gameId: number): { success: boolean; result: string; fen: string } {
    this.ensureLoaded(gameId)
    const humanSide = this.humanSides.get(gameId)
    if (!humanSide) return { success: false, result: '', fen: '' }
    const result = humanSide === 'red' ? 'black' : 'red'
    const pos = this.positions.get(gameId)
    const fen = pos ? pos.fen() : ''
    // 走 finish 统一收尾：写库 + 清理本局全部内存态（resign 此前漏清，属内存泄漏）
    this.finish(gameId, result as Side | 'draw')
    return { success: true, result, fen }
  }

  offerDraw(gameId: number): { accepted: boolean; fen: string } {
    this.ensureLoaded(gameId)
    const mode = this.modes.get(gameId)
    // 看局面应答(用最近一手 AI 落定后的红方视角评分),无评分时退回旧概率:
    //   AI 明显劣势(≤-80cp)→ 接受;AI 明显优势(≥+150cp)→ 拒绝;胶着 → 按模式概率。
    const humanSide = this.humanSides.get(gameId)
    const prevRed = this.prevRedCp.get(gameId) ?? null
    let accepted: boolean
    if (prevRed !== null && humanSide) {
      const aiSide: Side = humanSide === 'red' ? 'black' : 'red'
      const aiCp = aiSide === 'red' ? prevRed : -prevRed
      if (aiCp <= -80) accepted = true
      else if (aiCp >= 150) accepted = false
      else accepted = Math.random() < (mode === 'coach' ? 0.6 : 0.4)
    } else {
      accepted = Math.random() < (mode === 'coach' ? 0.8 : 0.6)
    }
    let fen = ''
    if (accepted) {
      const pos = this.positions.get(gameId)
      fen = pos ? pos.fen() : ''
      this.finish(gameId, 'draw')
    }
    return { accepted, fen }
  }

  /** 每局悔棋上限(服务端权威;前端展示 remaining) */
  static readonly MAX_UNDOS = 3

  undoLastMoves(gameId: number): { success: boolean; fen: string; undoRemaining: number } {
    // 完局守卫:已终局的对局不可悔棋(否则重建僵尸局 + 悔到 AI 回合却给人起钟致死锁)
    if (this.isFinished(gameId)) return { success: false, fen: '', undoRemaining: 0 }
    this.ensureLoaded(gameId)
    const used = this.undoCounts.get(gameId) ?? 0
    const remainingBudget = GameSession.MAX_UNDOS - used
    const pos = this.positions.get(gameId)
    if (!pos) return { success: false, fen: '', undoRemaining: remainingBudget }
    const mode = this.modes.get(gameId)
    if (mode !== 'coach') return { success: false, fen: '', undoRemaining: remainingBudget }
    if (remainingBudget <= 0) return { success: false, fen: '', undoRemaining: 0 }

    const moves = this.deps.repo.getMoves(gameId)
    if (moves.length < 2) return { success: false, fen: '', undoRemaining: remainingBudget }

    this.deps.repo.deleteLastMove(gameId)
    this.deps.repo.deleteLastMove(gameId)

    // 与 ensureLoaded 同源重放:同步回滚 positions/repeatHistories/noCapturePlies,
    // 避免被撤两手残留在重复历史里污染三次重复/60回合裁决。
    const g = this.deps.repo.getGame(gameId)!
    this.rebuildDerivedState(gameId, g.startFen)
    const newPos = this.positions.get(gameId)!

    const remaining = this.deps.repo.getMoves(gameId)
    const lastAi = remaining.filter(m => m.byAi).pop()
    this.prevRedCp.set(gameId, lastAi?.scoreCp ?? null)

    this.undoCounts.set(gameId, used + 1)

    // 悔棋后按重建局面的实际行棋方起钟(正常删 2 手回到人类;不假定,读 sideToMove 更稳)
    const clock = this.clockStates.get(gameId)
    if (clock) {
      this.settleActive(clock, false)
      this.startClockFor(clock, newPos.sideToMove())
    }

    return { success: true, fen: newPos.fen(), undoRemaining: GameSession.MAX_UNDOS - (used + 1) }
  }

  private finish(gameId: number, result: Side | 'draw') {
    this.deps.repo.finishGame(gameId, result, this.deps.clock())
    // 局末清理所有按 gameId 累积的内存态,防渐进内存泄漏 + gameId 复用误判
    this.positions.delete(gameId)
    this.modes.delete(gameId)
    this.humanSides.delete(gameId)
    this.lastMoveAt.delete(gameId)
    this.lastMoveMs.delete(gameId)
    this.repeatHistories.delete(gameId)
    this.noCapturePlies.delete(gameId)
    this.prevRedCp.delete(gameId)
    this.lastHumanBlunder.delete(gameId)
    this.clockStates.delete(gameId)
    this.undoCounts.delete(gameId)
  }

  /** 有走钟在途的活跃局(供 ws-server 超时清扫器遍历)。 */
  activeClockGameIds(): number[] {
    const ids: number[] = []
    for (const [id, c] of this.clockStates) {
      if (c.activeSide !== null && c.startedAt !== null) ids.push(id)
    }
    return ids
  }
}
