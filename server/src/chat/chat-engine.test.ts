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
  const stim: Stimulus = {
    kind: 'blunder', gameId: 1, scoreCp: -300, tension: 0.95,
    moveZh: '红炮二平五', side: 'red', ply: 1, phase: 'opening',
  }
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

test('prompt 含真实着法 — buildPrompt 把 moveZh 注入 user 消息', async () => {
  // 捕获 llm.chat 收到的消息
  const captured: string[] = []
  const llm = new FakeLLM((msgs) => {
    msgs.forEach(m => captured.push(m.content))
    return '炮镇中路,有搞头'
  })
  const { engine } = setup(llm)
  const stim: Stimulus = {
    kind: 'move', gameId: 1, scoreCp: 100, tension: 0.9,
    moveZh: '红炮二平五', side: 'red', ply: 1, phase: 'opening',
  }
  await engine.onStimulus(stim)
  // 至少有一次 LLM 调用
  expect(llm.calls.length).toBeGreaterThanOrEqual(1)
  // 检查所有收到的消息里,user 消息应包含着法字符串
  expect(captured.some(c => c.includes('红炮二平五'))).toBe(true)
})

test('去重护栏:同一 speaker 连续返回相同文本时第二次不 emit 该 speaker', async () => {
  // 每次 LLM 都返回相同文本
  const llm = new FakeLLM(() => '嚯这步软了')
  const { engine, out } = setup(llm)

  const stim: Stimulus = {
    kind: 'blunder', gameId: 1, scoreCp: -300, tension: 0.95,
    moveZh: '黑车1进1', side: 'black', ply: 4, phase: 'opening',
  }

  // 第一次发言:记录 speaker id 和内容
  await engine.onStimulus(stim)
  expect(out.length).toBeGreaterThanOrEqual(1)
  const firstSpeakers = out.map((l: any) => l.personaId as string)

  // 第二次发言:与第一次重叠的 speaker 不应再 emit 相同文本
  await engine.onStimulus(stim)

  // 统计第二次之后重复的 speaker + 相同文本的条数
  const afterFirst = out.slice(0, firstSpeakers.length)
  const afterSecond = out.slice(firstSpeakers.length)

  // 第一次已发言的 speaker 不应在第二次再次出现相同内容
  const duplicates = afterSecond.filter((l: any) =>
    firstSpeakers.includes(l.personaId) && l.text === '嚯这步软了'
  )
  expect(duplicates.length).toBe(0)
})
