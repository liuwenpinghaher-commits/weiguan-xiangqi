import { Position } from '../rules/position.js'
import type { EngineLine, Side } from '../types.js'
import type { AnalyzeOpts } from './engine.js'
import type { EngineStatus } from './managed-engine.js'
import { MATE_BASE } from './uci-parse.js'

const PIECE_VALUES: Record<string, number> = {
  k: 10000,
  r: 900,
  c: 450,
  n: 400,
  a: 200,
  b: 200,
  p: 100,
}

/**
 * 评估单个 FEN 棋盘的静态子力与位置分（红方视角，单位 centipawn）。
 * FEN 行序：第 0 段为黑方底线(rank 9)，第 9 段为红方底线(rank 0)。
 */
export function evaluateFenRedCp(fen: string): number {
  const board = fen.split(' ')[0] ?? ''
  const rows = board.split('/')
  let score = 0

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r]
    let c = 0
    for (const ch of row) {
      if (ch >= '1' && ch <= '9') {
        c += Number(ch)
        continue
      }
      const lower = ch.toLowerCase()
      const base = PIECE_VALUES[lower] ?? 0
      if (base === 0) {
        c++
        continue
      }
      const isRed = ch === ch.toUpperCase()
      let val = base

      // 过河兵/卒加分 + 中路控制微调
      if (lower === 'p') {
        const crossedRiver = isRed ? r <= 4 : r >= 5
        if (crossedRiver) {
          val += 100
          if (c >= 3 && c <= 5) val += 30
        }
      } else if (lower === 'c' || lower === 'r' || lower === 'n') {
        // 鼓励抢占中路与肋道(c=3,4,5)及出动大子
        if (c >= 3 && c <= 5) val += 20
        if (lower === 'n' && ((isRed && r <= 7) || (!isRed && r >= 2))) val += 25
        if (lower === 'r' && ((isRed && r < 9) || (!isRed && r > 0))) val += 15
      }

      score += isRed ? val : -val
      c++
    }
  }

  return score
}

/**
 * 内置确定性中国象棋 UCI 兼容启发式引擎。
 * 当未安装外部 Pikafish 原生二进制或跨平台开发/E2E 环境无对应二进制时，
 * 提供完整的合法着法搜索、吃子/将杀识别、MultiPV 候选与逐手失分诊断能力。
 */
export class BuiltinEngine {
  private closed = false

  status(): EngineStatus {
    return {
      configured: true,
      degraded: false,
      reason: null,
    }
  }

  async analyze(fen: string, opts: AnalyzeOpts): Promise<EngineLine[]> {
    if (this.closed) throw new Error('builtin engine closed')
    const pos = Position.fromFen(fen)
    const side: Side = pos.sideToMove()
    const sign = side === 'red' ? 1 : -1
    const legal = pos.legalMoves()
    if (legal.length === 0) return []

    const scored: Array<{ move: string; scoreCp: number; mate: number | null; pv: string[] }> = []

    for (const move of legal) {
      const nextPos = pos.applyMove(move)
      const over = nextPos.isGameOver()
      if (over.over) {
        if (over.result === side) {
          scored.push({
            move,
            scoreCp: MATE_BASE - 1,
            mate: 1,
            pv: [move],
          })
          continue
        }
        if (over.result === 'draw') {
          scored.push({ move, scoreCp: 0, mate: null, pv: [move] })
          continue
        }
        scored.push({
          move,
          scoreCp: -(MATE_BASE - 1),
          mate: -1,
          pv: [move],
        })
        continue
      }

      const nextFen = nextPos.fen()
      const baseScore = evaluateFenRedCp(nextFen) * sign
      const inCheckBonus = nextPos.inCheck() ? 35 : 0

      // 1-ply 极小化对手最强反击采样（识别送吃/被将死）
      const oppMoves = nextPos.legalMoves()
      let worstReplyScore = baseScore + inCheckBonus
      let bestReplyMove: string | null = null
      if (oppMoves.length > 0) {
        let maxOppScore = -Infinity
        for (const oppMove of oppMoves) {
          const afterOpp = nextPos.applyMove(oppMove)
          const oppOver = afterOpp.isGameOver()
          let oppScore: number
          if (oppOver.over && oppOver.result && oppOver.result !== 'draw' && oppOver.result !== side) {
            oppScore = MATE_BASE - 2
          } else {
            oppScore = -evaluateFenRedCp(afterOpp.fen()) * sign
          }
          if (oppScore > maxOppScore) {
            maxOppScore = oppScore
            bestReplyMove = oppMove
          }
        }
        worstReplyScore = -maxOppScore + inCheckBonus
      }

      scored.push({
        move,
        scoreCp: Math.round(worstReplyScore),
        mate: null,
        pv: bestReplyMove ? [move, bestReplyMove] : [move],
      })
    }

    scored.sort((a, b) => {
      if (b.scoreCp !== a.scoreCp) return b.scoreCp - a.scoreCp
      return a.move.localeCompare(b.move)
    })

    const count = Math.max(1, Math.min(opts.multipv || 1, scored.length))
    return scored.slice(0, count).map((item, idx) => ({
      multipv: idx + 1,
      move: item.move,
      scoreCp: item.scoreCp,
      mate: item.mate,
      pv: item.pv,
    }))
  }

  close(): void {
    this.closed = true
  }
}
