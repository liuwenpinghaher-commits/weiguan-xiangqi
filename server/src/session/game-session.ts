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

  constructor(private deps: GameSessionDeps) {}

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

    // 从起始局面开始重放所有已入库的着法
    let pos = this.deps.makePosition(g.startFen)
    const moves = this.deps.repo.getMoves(gameId)

    // 初始化 repeatHistories：与 newGame 逻辑一致
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

      // 更新 repeatHistories（仅当 key 能力可用时）
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

      // 更新无吃子计数
      const captured = pieceCount(before.fen()) > pieceCount(pos.fen())
      noCapture = captured ? 0 : noCapture + 1
    }

    this.positions.set(gameId, pos)
    this.modes.set(gameId, g.mode)
    this.humanSides.set(gameId, g.humanSide)
    this.repeatHistories.set(gameId, repeatHistory)
    this.noCapturePlies.set(gameId, noCapture)
  }

  newGame(g: { mode: GameMode; humanSide: Side; startFen: string }): number {
    const id = this.deps.repo.createGame({ ...g, startedAt: this.deps.clock() })
    const startPos = this.deps.makePosition(g.startFen)
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

  async playHumanMove(gameId: number, move: string): Promise<{ aiMove: string | null; fen: string; over: boolean; result?: 'red' | 'black' | 'draw' }> {
    const clock = this.clockStates.get(gameId)
    if (clock && clock.activeSide !== null && clock.startedAt !== null) {
      const elapsed = Date.now() - clock.startedAt
      if (clock.activeSide === 'red') clock.redRemaining = Math.max(0, clock.redRemaining - elapsed)
      else clock.blackRemaining = Math.max(0, clock.blackRemaining - elapsed)
      const inc = this.deps.cfg.getEngineParams().clockIncrementSeconds * 1000
      if (clock.activeSide === 'red') clock.redRemaining += inc
      else clock.blackRemaining += inc
      clock.activeSide = null
      clock.startedAt = null
    }
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
    const ep = this.deps.cfg.getEngineParams()
    const lines = await this.deps.engine.analyze(afterHuman.fen(), { multipv: ep.multipv, movetime: ep.movetime })
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
      return { aiMove: decision.move, fen: afterAI.fen(), over: true, result }
    }
    if (clock) {
      const humanSide = this.humanSides.get(gameId)!
      clock.activeSide = humanSide
      clock.startedAt = Date.now()
    }
    return { aiMove: decision.move, fen: afterAI.fen(), over: false }
  }

  /**
   * AI 主动走一手（用于 humanSide='black' 时开局 AI 先手）。
   * - ensureLoaded 保证内存态已就绪。
   * - 若当前走子方 === humanSide（轮到人走），抛出 "not AI turn"。
   * - 否则用引擎分析当前局面，selectMove 选手，applyMove 落子，入库 by_ai。
   * - 触发 byPlayerPersona 刺激（与 playHumanMove AI 段一致）。
   * - 返回 { aiMove, fen, over, result? }。
   */
  async aiFirstMove(gameId: number): Promise<{ aiMove: string; fen: string; over: boolean; result?: 'red' | 'black' | 'draw' }> {
    this.ensureLoaded(gameId)
    const pos = this.positions.get(gameId)
    if (!pos) throw new Error('game not found')

    const humanSide = this.humanSides.get(gameId)!
    const currentSide = pos.sideToMove()
    if (currentSide === humanSide) {
      throw new Error(`not AI turn: side to move is ${currentSide}, human is ${humanSide}`)
    }

    // 引擎分析当前局面，AI 走一手
    const ep = this.deps.cfg.getEngineParams()
    const lines = await this.deps.engine.analyze(pos.fen(), { multipv: ep.multipv, movetime: ep.movetime })
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
      return { aiMove: decision.move, fen: afterAI.fen(), over: true, result }
    }

    return { aiMove: decision.move, fen: afterAI.fen(), over: false }
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
      || this.clockStates.has(gameId)
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

  pauseClock(gameId: number): void {
    const clock = this.clockStates.get(gameId)
    if (!clock || clock.activeSide === null || clock.startedAt === null) return
    const elapsed = Date.now() - clock.startedAt
    if (clock.activeSide === 'red') clock.redRemaining -= elapsed
    else clock.blackRemaining -= elapsed
    clock.activeSide = null
    clock.startedAt = null
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
  }
}
