import type { Theme } from '../types.js'

export interface ThemeSignals {
  cpLoss: number
  hadMateBefore: boolean
  tookMate: boolean
  lostMaterial: boolean
}

const BLUNDER = 300
const MISTAKE = 150
const INACCURACY = 50
const HANGS_MIN_LOSS = 200

/** 失误主题分类;优先级:错失杀棋 > 丢子 > 丢分分级 */
export function classifyTheme(s: ThemeSignals): Theme {
  if (s.hadMateBefore && !s.tookMate) return 'missed_mate'
  if (s.lostMaterial && s.cpLoss >= HANGS_MIN_LOSS) return 'hangs_piece'
  if (s.cpLoss >= BLUNDER) return 'blunder'
  if (s.cpLoss >= MISTAKE) return 'mistake'
  if (s.cpLoss >= INACCURACY) return 'inaccuracy'
  return 'ok'
}
