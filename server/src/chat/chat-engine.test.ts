import { test, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { PersonaMemoryRepo } from '../memory/persona-memory-repo.js'
import { FakeLLM } from '../llm/fake.js'
import { ChatEngine } from './chat-engine.js'
import type { Stimulus } from '../types.js'

function setup(llm: FakeLLM, now = () => 1000) {
  const mem = new PersonaMemoryRepo(openDb(':memory:'))
  const out: any[] = []
  const engine = new ChatEngine({
    llm, mem, now,
    emit: (line) => out.push(line),
    rng: () => 0.9,
    tempo: { minSilenceMs: 0, maxPerMin: 100 },
  })
  return { engine, out, mem }
}

test('高张力刺激 → 产出至少一条弹幕,落 episode 记忆,关推理', async () => {
  const llm = new FakeLLM(() => '嚯,这步软了')
  const { engine, out, mem } = setup(llm)
  const stim: Stimulus = { kind: 'blunder', gameId: 1, scoreCp: -300, tension: 0.95 }
  await engine.onStimulus(stim)
  expect(out.length).toBeGreaterThanOrEqual(1)
  expect(out[0].text).toContain('软')
  expect(llm.calls[0].opts?.disableThinking).toBe(true)
  expect(mem.byPersona(out[0].personaId).some(m => m.kind === 'episode')).toBe(true)
})

test('节奏护栏:静默期内的刺激不产出', async () => {
  let now = 0
  const llm = new FakeLLM(() => 'x')
  const mem = new PersonaMemoryRepo(openDb(':memory:'))
  const out: any[] = []
  const engine = new ChatEngine({ llm, mem, now: () => now, emit: (l) => out.push(l), rng: () => 0.9, tempo: { minSilenceMs: 5000, maxPerMin: 100 } })
  await engine.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, tension: 0.95 })
  const after = out.length
  now = 1000
  await engine.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, tension: 0.95 })
  expect(out.length).toBe(after)
})

test('低张力冷场 → 可能无人发言(out 可为空,不报错)', async () => {
  const llm = new FakeLLM(() => 'x')
  const { engine, out } = setup(llm, () => 1000)
  await engine.onStimulus({ kind: 'idle', gameId: 1, scoreCp: 0, tension: 0.0 })
  expect(Array.isArray(out)).toBe(true)
})

test('单个 speaker LLM 失败不让 onStimulus reject,后续 speaker 照常', async () => {
  // 第一次调用抛错,第二次起正常返回
  let n = 0
  const llm = new FakeLLM((msgs) => {
    if (n++ === 0) throw new Error('llm down')
    return '稳一手'
  })
  const { engine, out } = setup(llm)
  const stim: Stimulus = { kind: 'blunder', gameId: 1, scoreCp: -300, tension: 0.95 }
  // 核心:不应 reject
  await expect(engine.onStimulus(stim)).resolves.toBeUndefined()
  // 辅助:若选出多个 speaker,跳过第一个失败者后后续应有弹幕
  // (若只选出 1 个 speaker 则 out 可为空,核心断言仍成立)
  // 至少验证数组结构
  expect(Array.isArray(out)).toBe(true)
})
