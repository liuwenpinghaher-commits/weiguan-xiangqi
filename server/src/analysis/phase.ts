import type { Phase } from '../types.js'

/** 数 FEN 棋盘段里的车(r/R)、马(n/N)、炮(c/C)总数 */
export function countMajors(fen: string): number {
  const board = fen.split(' ')[0]
  let n = 0
  for (const ch of board) {
    if ('rRnNcC'.includes(ch)) n++
  }
  return n
}

const ENDGAME_MAJORS = 6
const OPENING_MAX_PLY = 16

/** 按子力 + 手数分类对局阶段;子力少先判残局,再判开局,否则中局 */
export function classifyPhase(ply: number, fenAfter: string): Phase {
  if (countMajors(fenAfter) <= ENDGAME_MAJORS) return 'endgame'
  if (ply <= OPENING_MAX_PLY) return 'opening'
  return 'midgame'
}
