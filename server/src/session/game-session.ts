import type { GamesRepo } from '../store/games-repo.js'
import type { EngineLine, GameMode, Side, DirectorContext, Stimulus } from '../types.js'
import { selectMove } from '../director/director.js'
import { describeMoveZh } from '../rules/describe-move.js'
import { computePlayerState } from './player-state.js'
import { adjudicate } from '../rules/adjudicate.js'
import type { RepeatInfo } from '../rules/adjudicate.js'

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
  /** 可选:走子后触发聊天刺激 */
  onStimulus?: (s: Stimulus) => void
}

const MULTIPV = 5

/** 人着用时超过此值(毫秒)时触发 long_think 刺激 */
const LONG_THINK_THRESHOLD_MS = 8000

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

    return id
  }

  async playHumanMove(gameId: number, move: string): Promise<{ aiMove: string | null; fen: string; over: boolean }> {
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
      const endHumanKind = endHumanLastMs > LONG_THINK_THRESHOLD_MS ? 'long_think' : 'move'
      this.deps.onStimulus?.({
        kind: endHumanKind, gameId, scoreCp: null,
        moveZh: humanZh, side: humanTurn, ply: humanPly, phase,
        tension: humanZh?.includes('吃') ? 0.9 : (endHumanKind === 'long_think' ? 0.7 : 0.4),
      })
      return { aiMove: null, fen: afterHuman.fen(), over: true }
    }

    // 4. 计算 AI 回着(此处任何失败都抛出,且尚未写任何库、未改 position,可重试)
    const lines = await this.deps.engine.analyze(afterHuman.fen(), { multipv: MULTIPV, movetime: 500 })
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

    // 人着刺激:长考(>8s)时升级为 long_think 刺激并提升张力
    const humanLastMs = this.lastMoveMs.get(gameId) ?? 0
    const humanKind = humanLastMs > LONG_THINK_THRESHOLD_MS ? 'long_think' : 'move'
    const humanTension = humanKind === 'long_think'
      ? 0.7
      : (humanZh?.includes('吃') ? 0.9 : 0.55)
    this.deps.onStimulus?.({
      kind: humanKind, gameId, scoreCp: null,
      moveZh: humanZh, side: humanTurn, ply: humanPly, phase: humanPhase,
      tension: humanTension,
    })

    // AI 着刺激:decision.chosenLine.scoreCp 是"AI 走子方视角",转为红方视角
    const aiCp = decision.chosenLine.scoreCp
    // aiSide 是 AI 刚走完这步时的走子方(即 AI 方)
    const redCp = aiSide === 'red' ? aiCp : -aiCp
    // 张力:评分摆幅越大越想说(下限 0.5);吃子额外抬到 ≥0.9
    const aiBase = Math.max(0.5, Math.min(1, Math.abs(aiCp) / 300))
    const aiTension = aiZh?.includes('吃') ? Math.max(aiBase, 0.9) : aiBase
    this.deps.onStimulus?.({
      kind: 'move', gameId, scoreCp: redCp,
      moveZh: aiZh, side: aiSide, ply: aiPly, phase: aiPhase,
      tension: aiTension,
      byPlayerPersona: true,
    })

    // AI 着终局判定：isGameOver（将死/困毙）与重复裁决并存
    const aiOver = afterAI.isGameOver()
    const aiRepeat = this.checkRepeatAdjudicate(gameId, afterHuman, aiSide, afterAI)
    this.applyRepeatState(gameId, afterHuman, aiSide, afterAI)
    if (aiOver.over || aiRepeat !== null) {
      const result = aiOver.over ? aiOver.result! : aiRepeat!.result
      this.finish(gameId, result)
      return { aiMove: decision.move, fen: afterAI.fen(), over: true }
    }
    return { aiMove: decision.move, fen: afterAI.fen(), over: false }
  }

  private buildContext(gameId: number): DirectorContext {
    const mode = this.modes.get(gameId)!
    const recent = this.deps.repo.recentResults(10)  // 按各局自身 human_side 映射,无需传入
    const lastMoveMs = this.lastMoveMs.get(gameId) ?? 0
    const playerState = computePlayerState(recent, lastMoveMs)
    // humanlike 模式用拟人强度 0.5（随机性适中）；coach 模式 strength 不参与决策但保持合理值
    const strength = mode === 'humanlike' ? 0.5 : 0.6
    return {
      mode,
      playerState,
      maxDropCp: 320,
      targetBand: { low: -50, high: 80 },
      strength,
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

  private finish(gameId: number, result: Side | 'draw') {
    this.deps.repo.finishGame(gameId, result, this.deps.clock())
  }
}
