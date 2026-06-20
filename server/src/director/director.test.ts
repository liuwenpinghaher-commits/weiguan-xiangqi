import { test, expect } from 'vitest'
import { selectMove } from './director.js'
import type { EngineLine, DirectorContext } from '../types.js'

const lines: EngineLine[] = [
  { multipv: 1, move: 'b0c2', scoreCp: 300, mate: null, pv: ['b0c2'] },
  { multipv: 2, move: 'h2e2', scoreCp: 40,  mate: null, pv: ['h2e2'] },
  { multipv: 3, move: 'a0a1', scoreCp: -500, mate: null, pv: ['a0a1'] },
]

const baseCoach: DirectorContext = {
  mode: 'coach',
  playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 },
  maxDropCp: 320,
  targetBand: { low: -50, high: 80 },
  strength: 0.5,
  rng: () => 0,
}

test('陪练:挑落在目标带内的着法,而非最优大优着', () => {
  const d = selectMove(lines, baseCoach)
  expect(d.move).toBe('h2e2')
})

test('防穿帮:绝不选让分超过 maxDropCp 的臭着', () => {
  const d = selectMove(lines, baseCoach)
  expect(d.move).not.toBe('a0a1')
})

test('防穿帮:若所有次优都超限,则回退到最优着(不送)', () => {
  const tight: DirectorContext = { ...baseCoach, maxDropCp: 50 }
  const d = selectMove(lines, tight)
  expect(d.move).toBe('b0c2')
})

test('连败:目标带自动下调(更让玩家),仍守防穿帮', () => {
  const losing: DirectorContext = { ...baseCoach, playerState: { winStreak: 0, lossStreak: 3, lastMoveMs: 0 } }
  const d = selectMove(lines, losing)
  expect(d.move).toBe('h2e2')
  expect(d.reason).toMatch(/连败|让/)
})

test('杀棋例外:能将死时不放水,直接取杀', () => {
  const mateLines: EngineLine[] = [
    { multipv: 1, move: 'c3c4', scoreCp: 29997, mate: 3, pv: ['c3c4'] },
    { multipv: 2, move: 'h2e2', scoreCp: 30, mate: null, pv: ['h2e2'] },
  ]
  const d = selectMove(mateLines, baseCoach)
  expect(d.move).toBe('c3c4')
})

const baseHuman: DirectorContext = {
  mode: 'humanlike',
  playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 },
  maxDropCp: 1000,
  targetBand: { low: 0, high: 0 },
  strength: 1,
  rng: () => 0,
}

test('拟人:strength=1 且 rng=0 取最优着', () => {
  const d = selectMove(lines, { ...baseHuman, strength: 1 })
  expect(d.move).toBe('b0c2')
})

test('拟人:strength 低 + rng 偏大时会挑次优着(更像人会失误)', () => {
  const d = selectMove(lines, { ...baseHuman, strength: 0.2, rng: () => 0.99 })
  expect(['h2e2', 'a0a1']).toContain(d.move)
  expect(d.move).not.toBe('b0c2')
})

test('拟人:同样守杀棋例外', () => {
  const mateLines: EngineLine[] = [
    { multipv: 1, move: 'c3c4', scoreCp: 29997, mate: 3, pv: ['c3c4'] },
    { multipv: 2, move: 'h2e2', scoreCp: 30, mate: null, pv: ['h2e2'] },
  ]
  expect(selectMove(mateLines, { ...baseHuman, strength: 0.1, rng: () => 0.99 }).move).toBe('c3c4')
})

// ─── P1-6: 导演使用长考信号 ────────────────────────────────────────────────────

/**
 * 长考信号测试设计:
 *
 * 候选集: x=300, y=72, z=40
 * targetBand={low:60, high:80}, maxDropCp=320
 * center = (60+80)/2 = 70
 *
 * 无长考(lastMoveMs=0):
 *   shift = 0*(-20)+0*15 = 0 → band=[60,80]
 *   pool=[x=300, y=72, z=40](均在 maxDropCp=320 内)
 *   inBand: x=300>80 排出, y=72 in [60,80] ✓, z=40<60 排出
 *   inBand=[y_mid=72] → 选 y_mid
 *
 * 长考(lastMoveMs=12000>8000):
 *   shift = 0*(-20)+0*15 + (-10) = -10 → band=[50,70]
 *   pool=[x,y,z]
 *   inBand: x=300>70 排出, y=72>70 排出, z=40<50 排出 → inBand=[]
 *   回退到 pool → center=(50+70)/2=60 → 距: x=240, y=12, z=20 → y最近 → 仍选 y_mid
 *   —— 仍相同 ——
 *
 * 重设: targetBand={low:60, high:80}, 长考时 band=[50,70]
 * 需要让 y 在无长考时 in band 但长考后 fall out 且另一个着法更近:
 *   候选: x=300, y=72(无长考带内), z=55(无长考也在带内 55>60? 不满足)
 *
 * 最终方案: 让 z=55 在长考带[50,70]内但不在无长考带[60,80]内:
 *   无长考: band=[60,80] → y=72 in, z=55<60 out → inBand=[y] → 选 y_mid
 *   长考:   band=[50,70] → y=72>70 out, z=55 in [50,70] ✓ → inBand=[z] → 选 z_lower
 */
const longThinkLines: EngineLine[] = [
  { multipv: 1, move: 'x_best',  scoreCp: 300, mate: null, pv: ['x_best'] },
  { multipv: 2, move: 'y_mid',   scoreCp: 72,  mate: null, pv: ['y_mid'] },
  { multipv: 3, move: 'z_lower', scoreCp: 55,  mate: null, pv: ['z_lower'] },
]
const longThinkBase: DirectorContext = {
  mode: 'coach',
  playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 },
  maxDropCp: 320,
  targetBand: { low: 60, high: 80 },
  strength: 0.5,
  rng: () => 0,
}

test('长考信号:lastMoveMs=0 时陪练带内选 y_mid(scoreCp=72)', () => {
  const d = selectMove(longThinkLines, { ...longThinkBase, playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 } })
  // band=[60,80]: y=72 in ✓, z=55<60 out → 选 y_mid
  expect(d.move).toBe('y_mid')
})

test('长考信号:lastMoveMs=12000(>8000) 时 band 下移-10=[50,70], y=72超上沿改选 z_lower(55)', () => {
  const d = selectMove(longThinkLines, { ...longThinkBase, playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 12000 } })
  // shift=-10 → band=[50,70]: y=72>70 out ✓, z=55 in [50,70] → 选 z_lower
  expect(d.move).toBe('z_lower')
})

// ─── P1-7: 失误信号(recentBlunder) ────────────────────────────────────────────

/**
 * recentBlunder 测试设计：
 *
 * 候选集: x=300, y=72, z=55
 * targetBand={low:60, high:80}, maxDropCp=320
 * center=(60+80)/2=70
 *
 * 无 recentBlunder: shift = 0*(-20)+0*15 = 0 → band=[60,80]
 *   inBand: y=72 ✓ → 选 y_mid
 *
 * recentBlunder=true: shift += -15 → shift=-15 → band=[45,65]
 *   inBand: y=72>65 out, z=55 in [45,65] ✓ → 选 z_lower
 *   (玩家刚失误→ AI 让一档,让局面更让玩家可回血)
 */

test('recentBlunder=false 时无额外松档,仍选 y_mid(scoreCp=72)', () => {
  const d = selectMove(longThinkLines, {
    ...longThinkBase,
    playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0, recentBlunder: false },
  })
  // band=[60,80]: y=72 in → 选 y_mid
  expect(d.move).toBe('y_mid')
})

test('recentBlunder=true 时 band 再松-15=[45,65], y=72超上沿改选 z_lower(55)', () => {
  const d = selectMove(longThinkLines, {
    ...longThinkBase,
    playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0, recentBlunder: true },
  })
  // shift=-15 → band=[45,65]: y=72>65 out, z=55 in ✓ → 选 z_lower
  expect(d.move).toBe('z_lower')
})
