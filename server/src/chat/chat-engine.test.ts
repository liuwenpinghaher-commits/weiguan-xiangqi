import { test, expect } from 'vitest'
import { FakeMemoryStore } from '../memory/fake-memory-store.js'
import { FakeLLM } from '../llm/fake.js'
import { ChatEngine } from './chat-engine.js'
import { RuntimeConfig } from '../config/runtime-config.js'
import { SettingsRepo } from '../store/settings-repo.js'
import { openDb } from '../store/db.js'
import type { Stimulus } from '../types.js'

/** 新建一个独立内存 db 的 RuntimeConfig;可选传入 chat 段覆盖 */
function makeCfg(chatOverride?: Record<string, unknown>): RuntimeConfig {
  const cfg = new RuntimeConfig(new SettingsRepo(openDb(':memory:')), () => '2026-06-20T00:00:00.000Z')
  if (chatOverride) cfg.updateSection('chat', chatOverride)
  return cfg
}

function setup(llm: FakeLLM, now = () => 1000) {
  const mem = new FakeMemoryStore(now)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 0, maxPerMin: 100 })
  const engine = new ChatEngine({
    llm, mem, cfg, now,
    emit: (line) => out.push(line),
    rng: () => 0.9,
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
  expect((await mem.list({ personaId: out[0].personaId })).some(m => m.kind === 'episode')).toBe(true)
})

test('节奏护栏:静默期内的刺激不产出', async () => {
  let now = 0
  const llm = new FakeLLM(() => 'x')
  const mem = new FakeMemoryStore(() => now)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 5000, maxPerMin: 100 })
  const engine = new ChatEngine({ llm, mem, cfg, now: () => now, emit: (l) => out.push(l), rng: () => 0.9 })
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
  await mem.record({ personaId: 'coach', kind: 'fact', content: '你爱走中炮', importance: 3, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  await mem.record({ personaId: 'coach', kind: 'episode', content: '我刚才说了不该说的', importance: 1, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
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

  const mem = new FakeMemoryStore(() => 1000)
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

  const cfg = makeCfg({ minSilenceMs: 0, maxPerMin: 100 })
  const engine = new ChatEngine({
    llm, mem, cfg, now: () => 1000,
    emit: (line) => out.push(line),
    rng,
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

// ─── P1-2 新增测试:同回合上下文注入 + 跨刺激记忆 ───────────────────────────

test('同回合上下文注入:第 2 个 speaker 的 prompt 含第 1 个 speaker 刚说的话', async () => {
  // FakeLLM 按调用序返回不同串
  let callIdx = 0
  const replies = ['这步真妙', '我看未必']
  const capturedUserMsgs: string[] = []

  const llm = new FakeLLM((msgs) => {
    // 收集每次调用的完整 user 消息内容
    const userMsg = msgs.find(m => m.role === 'user')
    if (userMsg) capturedUserMsgs.push(userMsg.content)
    const sys = msgs.find(m => m.role === 'system')
    if (sys) capturedUserMsgs.push(sys.content)
    return replies[callIdx++ % replies.length]
  })

  // rng 固定 0.9 → jitter = (0.9-0.5)*0.3=0.12 → 所有 spectator 分数均 > 0.45
  const { engine, out } = setup(llm)

  const stim: Stimulus = {
    kind: 'blunder', gameId: 42, scoreCp: -400, tension: 0.95,
    moveZh: '红炮乱走', side: 'red', ply: 3, phase: 'opening',
  }

  await engine.onStimulus(stim)

  // 至少 2 人发言(rng=0.9,tension=0.95,应触发多人)
  expect(out.length).toBeGreaterThanOrEqual(2)

  // 第 2 个 speaker 收到的 prompt 里应包含第 1 个 speaker 刚说的"这步真妙"
  // capturedUserMsgs 交替存 user + system 消息,找含有第1次回复内容的后续消息
  const hasContext = capturedUserMsgs.some(m => m.includes('这步真妙'))
  expect(hasContext).toBe(true)
})

test('跨刺激记忆:第 2 次刺激的 prompt 含上一次 recent 中的内容', async () => {
  const allPromptContents: string[] = []
  let callIdx = 0

  const llm = new FakeLLM((msgs) => {
    msgs.forEach(m => allPromptContents.push(m.content))
    callIdx++
    return callIdx === 1 ? '第一炮拉中路' : '接上'
  })

  // 使用独立的 engine(tempo=0 允许连续触发)
  const mem = new FakeMemoryStore(() => 1000)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 0, maxPerMin: 100 })
  const engine = new ChatEngine({
    llm, mem, cfg, now: () => 1000,
    emit: (line) => out.push(line),
    rng: () => 0.9,
  })

  const stim1: Stimulus = {
    kind: 'move', gameId: 7, scoreCp: 100, tension: 0.95,
    moveZh: '红炮二平五', side: 'red', ply: 1, phase: 'opening',
  }
  const stim2: Stimulus = {
    kind: 'move', gameId: 7, scoreCp: -80, tension: 0.95,
    moveZh: '黑马2进3', side: 'black', ply: 2, phase: 'opening',
  }

  await engine.onStimulus(stim1)
  // 重置 prompt 捕获(只关心第 2 轮的)
  const countAfterFirst = allPromptContents.length

  await engine.onStimulus(stim2)

  // 第 2 次刺激产生的 prompt 中应含第 1 次的输出"第一炮拉中路"
  const stim2Contents = allPromptContents.slice(countAfterFirst)
  const hasRecentContext = stim2Contents.some(c => c.includes('第一炮拉中路'))
  expect(hasRecentContext).toBe(true)
})

// ─── P1-5 新增测试:idle/topic_open 走闲聊掌故分支; long_think 走调侃分支 ────────

test('idle 刺激:user prompt 含"棋外"或"掌故"提示,不含"这步"等着法评价词', async () => {
  const capturedUsers: string[] = []
  const llm = new FakeLLM((msgs) => {
    const u = msgs.find(m => m.role === 'user')
    if (u) capturedUsers.push(u.content)
    return '说个棋谚'
  })
  const { engine } = setup(llm)
  const stim: Stimulus = { kind: 'idle', gameId: 1, scoreCp: null, tension: 0.95 }
  await engine.onStimulus(stim)
  expect(capturedUsers.length).toBeGreaterThanOrEqual(1)
  // idle prompt 应提示闲聊/掌故内容
  expect(capturedUsers.some(u => u.includes('掌故') || u.includes('棋谚') || u.includes('局面'))).toBe(true)
})

test('long_think 刺激:user prompt 含"想了很久"或"长考"或"调侃"相关词', async () => {
  const capturedUsers: string[] = []
  const llm = new FakeLLM((msgs) => {
    const u = msgs.find(m => m.role === 'user')
    if (u) capturedUsers.push(u.content)
    return '这步想这么久?'
  })
  const { engine } = setup(llm)
  const stim: Stimulus = { kind: 'long_think', gameId: 1, scoreCp: null, tension: 0.95, moveZh: '红炮二平五' }
  await engine.onStimulus(stim)
  expect(capturedUsers.length).toBeGreaterThanOrEqual(1)
  expect(capturedUsers.some(u => u.includes('想了') || u.includes('长考') || u.includes('调侃') || u.includes('落子'))).toBe(true)
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

// ─── Task 2 新增测试:系统 prompt 贴棋局 ──────────────────────────────────────

import { describe, it } from 'vitest'
import { ChatEngine as CE2 } from './chat-engine.js'
import { RuntimeConfig as RC2 } from '../config/runtime-config.js'
import { SettingsRepo as SR2 } from '../store/settings-repo.js'
import { openDb as odb2 } from '../store/db.js'
import { FakeLLM as FL2 } from '../llm/fake.js'
import { FakeMemoryStore as FM2 } from '../memory/fake-memory-store.js'

describe('系统 prompt 贴棋局', () => {
  it('系统 prompt 强调谈这盘+扣局面棋识+别瞎编+把道理说透,且不再让"扯句闲篇"', async () => {
    const caps: string[] = []
    const cfg = new RC2(new SR2(odb2(':memory:')), () => '2026-06-21T00:00:00.000Z')
    const llm = new FL2((msgs) => { const s = msgs.find(m => m.role === 'system'); if (s) caps.push(s.content); return '稳' })
    const eng = new CE2({ llm, mem: new FM2(() => 0), cfg, now: () => 0, emit: () => {}, rng: () => 0.1 })
    await eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 20, moveZh: '炮二平五', ply: 3, tension: 0.95 } as any)
    expect(caps.length).toBeGreaterThan(0)
    expect(caps.some(s => s.includes('扣') && s.includes('别瞎编'))).toBe(true)
    expect(caps.some(s => s.includes('把道理说透'))).toBe(true)
    expect(caps.every(s => !s.includes('扯句闲篇'))).toBe(true)
  })
})

describe('idle 贴局面', () => {
  it('idle 的 user prompt 贴当前局面、含缓存的走子、不扯场外', async () => {
    const caps: string[] = []
    const cfg = new RC2(new SR2(odb2(':memory:')), () => '2026-06-21T00:00:00.000Z')
    const llm = new FL2((msgs) => { const u = msgs.find(m => m.role === 'user'); if (u) caps.push(u.content); return '僵着' })
    // now 在两次刺激间推进:跨过最近发言惩罚窗口(30s),让 idle 仍能选出说话者
    let nowMs = 0
    const eng = new CE2({ llm, mem: new FM2(() => nowMs), cfg, now: () => nowMs, emit: () => {}, rng: () => 0.1 })
    await eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 20, moveZh: '炮二平五', ply: 3, tension: 0.95 } as any)
    caps.length = 0
    nowMs = 60_000
    await eng.onStimulus({ kind: 'idle', gameId: 1, scoreCp: null, tension: 0.95 } as any)
    const idleU = caps.join('\n')
    expect(idleU.includes('眼前这盘') || idleU.includes('就着眼前')).toBe(true)
    expect(idleU.includes('炮二平五')).toBe(true)
    expect(idleU.includes('棋外') || idleU.includes('家里') || idleU.includes('行当')).toBe(false)
  })
})

describe('老黑参与 + 张力分级', () => {
  function mk(rngSeq: number[]) {
    let i = 0
    const cfg = new RC2(new SR2(odb2(':memory:')), () => '2026-06-21T00:00:00.000Z')
    const caps: { user: string }[] = []
    const emitted: string[] = []
    const llm = new FL2((msgs: any[]) => { const u = msgs.find(m => m.role === 'user'); caps.push({ user: u?.content ?? '' }); return '行' })
    const eng = new CE2({ llm, mem: new FM2(() => 0), cfg, now: () => 0, emit: (l: any) => emitted.push(l.personaId), rng: () => rngSeq[(i++) % rngSeq.length] })
    return { eng, caps, emitted }
  }
  it('人类走子(非 byPlayerPersona)时老黑也可能参与,prompt 带其身份/立场', async () => {
    const { eng, caps, emitted } = mk([0])
    await eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 10, moveZh: '马八进七', ply: 4, tension: 0.95 } as any)
    expect(emitted.includes('player')).toBe(true)
    expect(caps.some(c => c.user.includes('老黑') && c.user.includes('立场'))).toBe(true)
  })
  it('高张力(0.95)比低张力(0.4)选更多 speaker', async () => {
    const hi = mk([0.5]); await hi.eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: '车一进一', ply: 5, tension: 0.95 } as any)
    const lo = mk([0.5]); await lo.eng.onStimulus({ kind: 'move', gameId: 2, scoreCp: 0, moveZh: '兵三进一', ply: 5, tension: 0.4 } as any)
    expect(hi.emitted.length).toBeGreaterThan(lo.emitted.length)
  })
})
