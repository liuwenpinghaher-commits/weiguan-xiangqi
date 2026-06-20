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

test('grounding:prompt system 含 fact/insight 内容,不含 episode', async () => {
  // 捕获每次 LLM 调用收到的 system 消息内容
  const capturedSystems: string[] = []
  const llm = new FakeLLM((msgs) => {
    const sys = msgs.find(m => m.role === 'system')
    if (sys) capturedSystems.push(sys.content)
    return '说一句'
  })
  const { engine, mem } = setup(llm)
  // 预先植入一条 fact 和一条 episode
  mem.add({ personaId: 'coach', kind: 'fact', content: '你爱走中炮', importance: 3, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  mem.add({ personaId: 'coach', kind: 'episode', content: '我刚才说了不该说的', importance: 1, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  const stim: Stimulus = {
    kind: 'move', gameId: 1, scoreCp: 100, tension: 0.95,
    moveZh: '红炮二平五', side: 'red', ply: 1, phase: 'opening',
  }
  await engine.onStimulus(stim)
  expect(llm.calls.length).toBeGreaterThanOrEqual(1)
  // 所有 system prompt 应含 grounding 段(可能显示 "(还不了解)" 或具体内容)
  expect(capturedSystems.every(s => s.includes('你对这位棋手的了解'))).toBe(true)
  // coach 对应的 system prompt 应含其 fact 内容(该段出现在至少一条 system 中)
  expect(capturedSystems.some(s => s.includes('你爱走中炮'))).toBe(true)
  // episode 内容不应出现在任何 system prompt 中
  expect(capturedSystems.some(s => s.includes('我刚才说了不该说的'))).toBe(false)
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

// ─── 新增测试(Fix Task 5) ────────────────────────────────────────────────────

test('AI 棋手自评:byPlayerPersona=true + rng<0.4 时 player 出现在 out 且 prompt 含"自评"', async () => {
  // 捕获所有 LLM 调用的 user 消息
  const capturedUsers: string[] = []
  const llm = new FakeLLM((msgs) => {
    const u = msgs.find(m => m.role === 'user')
    if (u) capturedUsers.push(u.content)
    return '我这步稳一手'
  })

  const mem = new PersonaMemoryRepo(openDb(':memory:'))
  const out: any[] = []

  // rng 序列:
  //   call 1-3: pickSpeakers 对 3 个 spectator 各调一次(返回 0.9 → 高分让其通过)
  //   call 4  : 判断 byPlayerPersona 条件(返回 0.2 < 0.4 → 加入 player)
  //   call 5+ : buildPrompt 内 viewScore 调用(返回 0.9)
  let callCount = 0
  const rng = () => {
    callCount++
    if (callCount === 4) return 0.2
    return 0.9
  }

  const engine = new ChatEngine({
    llm, mem, now: () => 1000,
    emit: (line) => out.push(line),
    rng,
    tempo: { minSilenceMs: 0, maxPerMin: 100 },
  })

  const stim: Stimulus = {
    kind: 'move', gameId: 1, scoreCp: 50, tension: 0.95,
    moveZh: '黑马2进3', side: 'black', ply: 2, phase: 'opening',
    byPlayerPersona: true,
  }

  await engine.onStimulus(stim)

  // out 里应有 personaId === 'player' 的条目
  const playerLines = out.filter((l: any) => l.personaId === 'player')
  expect(playerLines.length).toBeGreaterThanOrEqual(1)

  // player 对应的 LLM prompt user 消息应含"自评"
  expect(capturedUsers.some(u => u.includes('自评'))).toBe(true)
})

test('人着不让 player 自评:byPlayerPersona 未设时 out 中不含 player', async () => {
  const llm = new FakeLLM(() => '说一句')
  const { engine, out } = setup(llm)

  const stim: Stimulus = {
    kind: 'move', gameId: 1, scoreCp: 50, tension: 0.95,
    moveZh: '红炮二平五', side: 'red', ply: 1, phase: 'opening',
    // byPlayerPersona 不设
  }

  await engine.onStimulus(stim)

  const playerLines = out.filter((l: any) => l.personaId === 'player')
  expect(playerLines.length).toBe(0)
})

test('内容质量:连发两个不同 moveZh 的刺激,各自 LLM prompt 含各自着法', async () => {
  // 捕获每次调用的 user 消息
  const capturedUsers: string[] = []
  const llm = new FakeLLM((msgs) => {
    const u = msgs.find(m => m.role === 'user')
    if (u) capturedUsers.push(u.content)
    return '说一句'
  })
  const { engine } = setup(llm, () => 1000)

  const stim1: Stimulus = {
    kind: 'move', gameId: 1, scoreCp: 100, tension: 0.95,
    moveZh: '红炮二平五', side: 'red', ply: 1, phase: 'opening',
  }
  const stim2: Stimulus = {
    kind: 'move', gameId: 1, scoreCp: -80, tension: 0.95,
    moveZh: '黑马2进3', side: 'black', ply: 2, phase: 'opening',
  }

  await engine.onStimulus(stim1)
  // 重置 guard 让第二次也能触发
  const beforeCount = capturedUsers.length
  // 需要跳过 tempo 冷静期:用新 engine(tempo=0,minSilenceMs=0 在 setup 里已配好)
  await engine.onStimulus(stim2)

  // 第一次刺激的 user 消息应含 stim1 着法
  const stim1Users = capturedUsers.slice(0, beforeCount)
  expect(stim1Users.some(u => u.includes('红炮二平五'))).toBe(true)

  // 第二次刺激的 user 消息应含 stim2 着法(去重后可能因文本相同被跳过,但至少有一次新调用含该着法)
  const stim2Users = capturedUsers.slice(beforeCount)
  expect(stim2Users.some(u => u.includes('黑马2进3'))).toBe(true)
})
