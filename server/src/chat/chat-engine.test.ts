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

function setup(llm: FakeLLM, now = () => 1000, chatOverride: Record<string, unknown> = {}) {
  const mem = new FakeMemoryStore(now)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 0, maxPerMin: 100, ...chatOverride })
  const engine = new ChatEngine({
    llm, mem, cfg, now,
    emit: (line) => out.push(line),
    rng: () => 0.9,
    repo: { getMoves: () => [] },
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
  expect((await mem.list({ personaId: out[0].personaId })).some(m => m.kind === 'episode')).toBe(true)
})

test('节奏护栏:静默期内的刺激不产出', async () => {
  let now = 0
  const llm = new FakeLLM(() => 'x')
  const mem = new FakeMemoryStore(() => now)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 5000, maxPerMin: 100 })
  const engine = new ChatEngine({ llm, mem, cfg, now: () => now, emit: (l) => out.push(l), rng: () => 0.9, repo: { getMoves: () => [] } })
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

test('forgetGame 清掉该局上下文:之后 idle prompt 不再含旧着法,降级为"这局还在走"', async () => {
  const captured: string[] = []
  const llm = new FakeLLM((msgs) => {
    msgs.forEach(m => captured.push(m.content))
    return 'ok'
  })
  // rng 固定 0(配 speakThreshold 拉高)保证每个 idle 刺激都有人发言,能捕获 prompt
  const mem = new FakeMemoryStore(() => 1000)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 0, maxPerMin: 100, speakThreshold: 1, jitterWidth: 0 })
  const engine = new ChatEngine({ llm, mem, cfg, now: () => 1000, emit: (l) => out.push(l), rng: () => 0, repo: { getMoves: () => [] } })
  // 1) 走一步,设入 lastCtx
  await engine.onStimulus({
    kind: 'move', gameId: 7, scoreCp: 100, tension: 0.9,
    moveZh: '红炮二平五', side: 'red', ply: 3, phase: 'opening',
  })
  // 基线:idle prompt 含旧着法(lastCtx 生效)
  captured.length = 0
  await engine.onStimulus({ kind: 'idle', gameId: 7, scoreCp: null, tension: 0.9 })
  expect(captured.join('\n')).toContain('红炮二平五')
  // 2) 忘掉这局
  engine.forgetGame(7)
  // 3) idle:此时无 lastCtx,prompt 不应再含旧着法(已降级,不带局面上下文)
  captured.length = 0
  await engine.onStimulus({ kind: 'idle', gameId: 7, scoreCp: null, tension: 0.9 })
  expect(captured.join('\n')).not.toContain('红炮二平五')
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

// ─── 新增测试:onStimulus 并发串行化 ─────────────────────────────────────────

test('并发重入串行化:两个重叠刺激不让同角色重复说同一句(第二个看到已更新的 lastText)', async () => {
  // FakeLLM 的 fn 是同步签名;改用一个带异步延迟的 LLM 包装,制造两次 onStimulus 重叠
  const slowLLM = {
    calls: [] as any[],
    async chat(messages: any, opts: any) {
      this.calls.push({ messages, opts })
      await new Promise((r) => setTimeout(r, 5))
      return '嚯这步软了'
    },
  }
  const mem = new FakeMemoryStore(() => 1000)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 0, maxPerMin: 100 })
  const engine = new ChatEngine({
    llm: slowLLM as any, mem, cfg, now: () => 1000,
    emit: (line) => out.push(line), rng: () => 0.9,
    repo: { getMoves: () => [] },
  })
  const stim: Stimulus = {
    kind: 'blunder', gameId: 1, scoreCp: -300, tension: 0.95,
    moveZh: '黑车1进1', side: 'black', ply: 4, phase: 'opening',
  }
  // 不 await 第一个就发第二个 → 重叠;串行化后第二个在第一个完成后处理
  const p1 = engine.onStimulus(stim)
  const p2 = engine.onStimulus(stim)
  await Promise.all([p1, p2])

  // 每个 personaId 的相同文本至多出现一次(去重护栏在串行下生效:第二轮看到 lastText 已更新)
  const byPersona = new Map<string, number>()
  for (const l of out) {
    if (l.text === '嚯这步软了') byPersona.set(l.personaId, (byPersona.get(l.personaId) ?? 0) + 1)
  }
  for (const [, count] of byPersona) {
    expect(count).toBe(1)
  }
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
    repo: { getMoves: () => [] },
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
  // 本用例专门验证"同回合多 speaker 上下文注入",需放开发言人数上限(默认 1)
  const { engine, out } = setup(llm, undefined, { maxSpeakers: 2 })

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
    repo: { getMoves: () => [] },
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
  // idle prompt 应提示闲聊/掌故/棋理内容(Task 5 起 idle 轮换局势总评/历史回顾/展望三种;
  // 本用例 rng 固定 0.9,dim=0.9 必落展望分支,文案用"棋理"而非旧版"棋谚")
  expect(capturedUsers.some(u => u.includes('掌故') || u.includes('棋理') || u.includes('局面'))).toBe(true)
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
  it('系统 prompt 强调点评这盘+多引经据典+扣局面别瞎编,不再让"扯句闲篇"', async () => {
    const caps: string[] = []
    const cfg = new RC2(new SR2(odb2(':memory:')), () => '2026-06-21T00:00:00.000Z')
    const llm = new FL2((msgs) => { const s = msgs.find(m => m.role === 'system'); if (s) caps.push(s.content); return '稳' })
    const eng = new CE2({ llm, mem: new FM2(() => 0), cfg, now: () => 0, emit: () => {}, rng: () => 0.1, repo: { getMoves: () => [] } })
    await eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 20, moveZh: '炮二平五', ply: 3, tension: 0.95 } as any)
    expect(caps.length).toBeGreaterThan(0)
    expect(caps.some(s => s.includes('扣') && s.includes('别瞎编'))).toBe(true)
    expect(caps.some(s => s.includes('引经据典'))).toBe(true)
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
    const eng = new CE2({ llm, mem: new FM2(() => nowMs), cfg, now: () => nowMs, emit: () => {}, rng: () => 0.1, repo: { getMoves: () => [] } })
    await eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 20, moveZh: '炮二平五', ply: 3, tension: 0.95 } as any)
    caps.length = 0
    nowMs = 60_000
    await eng.onStimulus({ kind: 'idle', gameId: 1, scoreCp: null, tension: 0.95 } as any)
    const idleU = caps.join('\n')
    // Task 5 起 idle 三选一轮换,三个分支共同前缀"这会儿没新棋步"取代旧版"就着眼前这盘说";
    // 本用例 rng 固定 0.1,dim=0.1 落局势总评分支,断言仍验证"贴着当前局面说、不扯场外"的原意图。
    expect(idleU.includes('这会儿没新棋步')).toBe(true)
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
    const eng = new CE2({ llm, mem: new FM2(() => 0), cfg, now: () => 0, emit: (l: any) => emitted.push(l.personaId), rng: () => rngSeq[(i++) % rngSeq.length], repo: { getMoves: () => [] } })
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

describe('记忆检索失败不让全场哑火', () => {
  it('coach_query 时 mem.retrieve 抛错,教练仍能作答(降级为无背景,而非被跳过)', async () => {
    const cfg = new RC2(new SR2(odb2(':memory:')), () => '2026-06-21T00:00:00.000Z')
    const emitted: string[] = []
    const llm = new FL2(() => '中炮稳')
    const mem = new FM2(() => 0)
    // 模拟记忆存储连接断开:每次检索都抛错
    mem.retrieve = async () => { throw new Error('记忆检索失败') }
    const eng = new CE2({ llm, mem, cfg, now: () => 0, emit: (l: any) => emitted.push(l.personaId), rng: () => 0.1, repo: { getMoves: () => [] } })
    await eng.onStimulus({ kind: 'coach_query', gameId: 1, scoreCp: null, humanText: '这步怎么样', engineInsight: null, tension: 0.9 } as any)
    // 检索失败不应导致 0 弹幕——背景降级为"还不了解",教练照常作答
    expect(emitted.length).toBeGreaterThan(0)
  })
})

describe('记忆落库失败不丢限流/上下文状态', () => {
  it('mem.record 抛错时仍 emit,且后续 speaker 的 prompt 含前一 speaker 的发言(roundSoFar 仍被填充)', async () => {
    const cfg = new RC2(new SR2(odb2(':memory:')), () => '2026-06-21T00:00:00.000Z')
    // 放开发言人数上限(默认 1),以验证同回合第 2 个 speaker 的 roundSoFar 上下文注入
    cfg.updateSection('chat', { maxSpeakers: 2 })
    const emitted: any[] = []
    const prompts: string[] = []
    let callIdx = 0
    // 第 1 个 speaker 说"妙手连珠",后续 speaker 应在上下文("刚才这桌在聊")里看到这句。
    // 上下文注入在 system 消息里(见 chat-engine plan() 的 contextLine),故两个 role 都收集。
    const llm = new FL2((msgs: any[]) => {
      msgs.forEach((m: any) => prompts.push(m.content))
      return callIdx++ === 0 ? '妙手连珠' : '我看悬'
    })
    // 落库每次都抛错(模拟 SurrealDB 断)
    const mem = new FM2(() => 0)
    mem.record = async () => { throw new Error('落库失败') }
    // rng 固定 0.9 → 高张力 0.95 选 ≥2 人
    const eng = new CE2({ llm, mem, cfg, now: () => 0, emit: (l: any) => emitted.push(l), rng: () => 0.9, repo: { getMoves: () => [] } })
    await eng.onStimulus({ kind: 'blunder', gameId: 1, scoreCp: -400, moveZh: '红炮乱走', ply: 3, tension: 0.95 } as any)
    // ① 落库失败不应吞掉发言
    expect(emitted.length).toBeGreaterThanOrEqual(1)
    // ② 至少 2 人发言,且后续 speaker 的 prompt 含第 1 个 speaker 的发言文本
    //    (roundSoFar 在 record 失败后仍被填充)
    expect(emitted.length).toBeGreaterThanOrEqual(2)
    expect(prompts.some(p => p.includes('妙手连珠'))).toBe(true)
  })
})

// ─── Task 1(叙事点评计划):丢旧保新——高频刺激保留最近2步 ──────────────────────

import { ChatEngine as CE3 } from './chat-engine.js'
import { RuntimeConfig as RC3 } from '../config/runtime-config.js'
import { SettingsRepo as SR3 } from '../store/settings-repo.js'
import { openDb as odb3 } from '../store/db.js'
import { FakeLLM as FL3 } from '../llm/fake.js'
import { FakeMemoryStore as FM3 } from '../memory/fake-memory-store.js'

describe('丢旧保新:高频刺激保留最近2步', () => {
  function mk(caps: string[]) {
    const cfg = new RC3(new SR3(odb3(':memory:')), () => '2026-06-21T00:00:00.000Z')
    // now 恒为 0:放开节奏护栏(默认 minSilenceMs=4000 会在同一时间戳下拦掉第 2 条处理的刺激,
    // 与本用例要测的"高频丢旧窗口"逻辑无关)——否则本该保留的第二步会被 TempoGuard 误伤,产生假失败。
    // 同时放开 speakThreshold/jitterWidth:now 恒为 0 会让"刚说过"的惩罚(pickSpeakers 里
    // sinceLast=0 → penalty=0.5)在连续多条刺激间不衰减,默认阈值 0.6 会让第一轮说过话的
    // 旁观者在后续刺激里全部被腰斩出局(实测验证过),导致本该由旁观者说出的转折点分支
    // 文案("转折"/"攻守易势")永远轮不到——清零后 score 恒为 tension-penalty,必然有人说话。
    cfg.updateSection('chat', { minSilenceMs: 0, maxPerMin: 100, speakThreshold: 0, jitterWidth: 0 })
    // 固定 rng 极小值使所有候选都过阈值发言,保证每条被处理的刺激都产出可观测的 user prompt
    const llm = new FL3((msgs: any[]) => { const u = msgs.find((m: any) => m.role === 'user'); if (u) caps.push(u.content); return '评' })
    return new CE3({ llm, mem: new FM3(() => 0), cfg, now: () => 0, emit: () => {}, rng: () => 0.01,
      repo: { getMoves: () => [] } as any })
  }

  it('并发 3 个 move 刺激,最旧一个被丢(只处理最近2步)', async () => {
    const caps: string[] = []
    const eng = mk(caps)
    const p1 = eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: '炮二平五', ply: 1, tension: 0.9 } as any)
    const p2 = eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: '马8进7',   ply: 2, tension: 0.9 } as any)
    const p3 = eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: '车9平8',   ply: 3, tension: 0.9 } as any)
    await Promise.all([p1, p2, p3])
    const joined = caps.join('\n')
    expect(joined.includes('马8进7')).toBe(true)   // 最近2步:保留
    expect(joined.includes('车9平8')).toBe(true)   // 最近2步:保留
    expect(joined.includes('炮二平五')).toBe(false) // 最旧:被丢
  })

  it('turning_point 不被高频丢旧跳过,且走转折点分支', async () => {
    const caps: string[] = []
    const eng = mk(caps)  // 复用该 describe 的 mk(注意它已带 minSilenceMs:0 覆盖)
    // 打满 3 条 move(触发丢旧窗口逐出)再发 1 条 turning_point:证明它既没被丢、又走对了
    // Task 5 新增的转折点专属 prompt 分支(断言内容特征,而非只数 caps 增长)。
    const ps = [
      eng.onStimulus({ kind: 'move', gameId: 3, scoreCp: 0, moveZh: '兵三进一', ply: 1, tension: 0.9 } as any),
      eng.onStimulus({ kind: 'move', gameId: 3, scoreCp: 0, moveZh: '马二进三', ply: 2, tension: 0.9 } as any),
      eng.onStimulus({ kind: 'move', gameId: 3, scoreCp: 0, moveZh: '车一平二', ply: 3, tension: 0.9 } as any),
      eng.onStimulus({ kind: 'turning_point', gameId: 3, scoreCp: 260, moveZh: '车八进六', ply: 4, tension: 0.95 } as any),
    ]
    await Promise.all(ps)
    expect(caps.some(u => u.includes('转折') || u.includes('攻守易势'))).toBe(true)
  })
})

// ─── Task 5:维度化 prompt——idle 轮换 + turning_point/phase_shift 分支 + persona 偏好 ──────

describe('多维度点评', () => {
  function mk(caps: string[], moves: any[] = []) {
    const cfg = new RC3(new SR3(odb3(':memory:')), () => '2026-06-21T00:00:00.000Z')
    // 除节奏护栏外,还要放开 speakThreshold/jitterWidth:pickSpeakers 的打分是
    // tension + (rng()-0.5)*jitterWidth,rng 固定在 0.01 时 jitter 恒为负,默认阈值 0.6
    // 会让 tension 0.5~0.7 的 phase_shift/idle 刺激一个说话人都选不出(实测验证过),
    // 导致断言的失败原因是"根本没人说话"而非"分支没写对"——与本 describe 要测的
    // prompt 分支内容无关,清零后 score 恒等于 tension,必然有人说话。
    cfg.updateSection('chat', { minSilenceMs: 0, maxPerMin: 100, speakThreshold: 0, jitterWidth: 0 })
    const llm = new FL3((msgs: any[]) => { const u = msgs.find((m: any) => m.role === 'user'); if (u) caps.push(u.content); return '评' })
    return new CE3({ llm, mem: new FM3(() => 0), cfg, now: () => 0, emit: () => {}, rng: () => 0.01,
      repo: { getMoves: () => moves } as any })
  }
  it('turning_point → 点评转折并回顾', async () => {
    const caps: string[] = []
    await mk(caps, [{ ply: 2, scoreCp: 10, side: 'red' }, { ply: 4, scoreCp: 260, side: 'red' }]).onStimulus(
      { kind: 'turning_point', gameId: 1, scoreCp: 260, moveZh: '车四进五', ply: 4, tension: 0.95 } as any)
    expect(caps.some(u => u.includes('转折') || u.includes('攻守易势'))).toBe(true)
  })
  it('phase_shift → 局势总评', async () => {
    const caps: string[] = []
    await mk(caps, [{ ply: 10, scoreCp: 80, side: 'red' }]).onStimulus(
      { kind: 'phase_shift', gameId: 1, scoreCp: 80, ply: 10, phase: 'midgame', tension: 0.7 } as any)
    expect(caps.some(u => u.includes('总评') || u.includes('局势') || u.includes('盘面'))).toBe(true)
  })
  it('idle 注入叙事(走势/转折)', async () => {
    const caps: string[] = []
    // rng 固定 0.01 → idle 走第一分支(局势总评),其 user 含 narrative 的"第X手/转折/走势"
    await mk(caps, [{ ply: 2, scoreCp: 10, side: 'red' }, { ply: 6, scoreCp: -240, side: 'red' }]).onStimulus(
      { kind: 'idle', gameId: 1, scoreCp: null, tension: 0.5 } as any)
    expect(caps.some(u => u.includes('第6手') || u.includes('转折') || u.includes('走势'))).toBe(true)
  })
})

// ─── I1 回归:关键刺激(turning_point/phase_shift)绕过最近发言惩罚,避免被"刚发言"误伤致静默 ──
// 背景:turning_point/phase_shift 往往紧跟在同一手的 move/blunder/brilliant 之后触发,
// 而那条刺激可能已经让最多 3 个旁观者发言。pickSpeakers 的"最近发言惩罚"会让这些刚说过话的
// 候选人分数骤降,若关键刺激仍复用同一份 recentMap,可能导致压根没人选中——"关键时刻"反而哑火。

describe('关键刺激绕过最近发言惩罚(I1)', () => {
  /** speakThreshold=0.5 是关键:round 1(无惩罚)score=tension(0.9)>=0.5 通过;
   *  若关键刺激仍套用 recentMap()(now 恒为 0 → sinceLast=0 → 满额惩罚 0.5),
   *  score = tension - 0.5,turning_point(0.95-0.5=0.45)/phase_shift(0.7-0.5=0.2)均 < 0.5 → 全员静默。
   *  jitterWidth=0 消除随机扰动;rng 固定 0.99 令 playerChimeProb(默认0.3)判定必不通过,
   *  把 player 排除在外,断言只反映 pickSpeakers/旁观者的行为。 */
  function mkKeyStimHarness(emitted: any[]) {
    const cfg = new RC3(new SR3(odb3(':memory:')), () => '2026-06-21T00:00:00.000Z')
    cfg.updateSection('chat', { minSilenceMs: 0, maxPerMin: 100, speakThreshold: 0.5, jitterWidth: 0 })
    const llm = new FL3((msgs: any[]) => {
      const u = msgs.find((m: any) => m.role === 'user')?.content ?? ''
      // 关键刺激的 prompt 分支含"转折"/"总评"字样;用不同回复文本避免被去重护栏误杀。
      return u.includes('转折') || u.includes('总评') ? '这是关键点评' : '照常点评一句'
    })
    return new CE3({
      llm, mem: new FM3(() => 0), cfg, now: () => 0,
      emit: (l: any) => emitted.push(l), rng: () => 0.99,
      repo: { getMoves: () => [] } as any,
    })
  }

  it('3 条 move 刺激令旁观者刚发言后,turning_point 仍至少产出一条弹幕', async () => {
    const emitted: any[] = []
    const eng = mkKeyStimHarness(emitted)

    for (let i = 0; i < 3; i++) {
      await eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: `第${i}步`, ply: i + 1, tension: 0.9 } as any)
    }
    // 前置条件:确实有旁观者说过话,"刚发言"惩罚场景才成立
    expect(emitted.length).toBeGreaterThanOrEqual(1)

    const before = emitted.length
    await eng.onStimulus(
      { kind: 'turning_point', gameId: 1, scoreCp: 260, moveZh: '车八进六', ply: 4, tension: 0.95 } as any)

    expect(emitted.length).toBeGreaterThan(before)
  })

  it('3 条 move 刺激令旁观者刚发言后,phase_shift 仍至少产出一条弹幕', async () => {
    const emitted: any[] = []
    const eng = mkKeyStimHarness(emitted)

    for (let i = 0; i < 3; i++) {
      await eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: `第${i}步`, ply: i + 1, tension: 0.9 } as any)
    }
    expect(emitted.length).toBeGreaterThanOrEqual(1)

    const before = emitted.length
    await eng.onStimulus(
      { kind: 'phase_shift', gameId: 1, scoreCp: 80, ply: 10, phase: 'midgame', tension: 0.7 } as any)

    expect(emitted.length).toBeGreaterThan(before)
  })
})

// ─── voice-qa-coach:coach_query——玩家提问只让教练结合引擎洞察作答(旁观让路) ──────────

test('coach_query:只教练发言(旁观让路),prompt 含问题与引擎洞察', async () => {
  const prompts: string[] = []
  const llm = new FakeLLM((msgs) => { msgs.forEach(m => prompts.push(m.content)); return '中路稳一手,先走马二进三' })
  const { engine, out } = setup(llm)
  await engine.onStimulus({
    kind: 'coach_query', gameId: 7, scoreCp: 40, humanText: '我这步该走哪?',
    engineInsight: { evalCp: 40, bestMoveZh: '红马二进三', pvZh: ['红马二进三', '黑炮8平5'], mate: null },
    tension: 0.9,
  } as any)
  expect(out.length).toBe(1)
  expect(out[0].personaId).toBe('coach')
  expect(out[0].addressee).toBe('human')
  expect(prompts.some(p => p.includes('我这步该走哪?'))).toBe(true)
  expect(prompts.some(p => p.includes('红马二进三'))).toBe(true)
})

test('coach_query:engineInsight=null 时降级(不含引擎数据,仍作答)', async () => {
  const prompts: string[] = []
  const llm = new FakeLLM((msgs) => { msgs.forEach(m => prompts.push(m.content)); return '凭手感,先稳住中路' })
  const { engine, out } = setup(llm)
  await engine.onStimulus({ kind: 'coach_query', gameId: 8, scoreCp: null, humanText: '现在谁占优?', engineInsight: null, tension: 0.9 } as any)
  expect(out.length).toBe(1)
  expect(out[0].personaId).toBe('coach')
  expect(prompts.some(p => p.includes('现在谁占优?'))).toBe(true)
  // 降级文案真出现:引擎不可用时提示"凭棋力判断",而非静默丢引擎段
  expect(prompts.some(p => p.includes('引擎暂不可用'))).toBe(true)
})

test('coach_query:mate 正负分别显示红方/黑方杀棋', async () => {
  const prompts: string[] = []
  const llm = new FakeLLM((msgs) => { msgs.forEach(m => prompts.push(m.content)); return 'x' })
  const { engine } = setup(llm)
  await engine.onStimulus({ kind: 'coach_query', gameId: 1, scoreCp: 30000, humanText: '有杀吗?', engineInsight: { evalCp: 30000, bestMoveZh: '红车一平四', pvZh: [], mate: 3 }, tension: 0.9 } as any)
  expect(prompts.some(p => p.includes('红方有3步杀'))).toBe(true)
  prompts.length = 0
  await engine.onStimulus({ kind: 'coach_query', gameId: 2, scoreCp: -30000, humanText: '危险吗?', engineInsight: { evalCp: -30000, bestMoveZh: '黑车9平6', pvZh: [], mate: -3 }, tension: 0.9 } as any)
  expect(prompts.some(p => p.includes('黑方有3步杀'))).toBe(true)
})

test('coach_query 不受静默限流闸拦截(玩家提问必答)', async () => {
  const now = () => 0
  // 两次刺激返回不同文本:否则若首条刺激恰好也选中 coach,coach_query 的同文本回答会被去重护栏
  // 吞掉(与限流闸无关),掩盖本用例要验证的"必答"行为。
  let n = 0
  const llm = new FakeLLM(() => (n++ === 0 ? '这步凶险' : '该走中路'))
  const mem = new FakeMemoryStore(now)
  const out: any[] = []
  const cfg = makeCfg({ minSilenceMs: 4000, maxPerMin: 12 })  // 生产默认限流(非 setup 的 0)
  const engine = new ChatEngine({ llm, mem, cfg, now, emit: (l) => out.push(l), rng: () => 0.9, repo: { getMoves: () => [] } })
  // 先发一条普通刺激占用静默窗(并 record 计配额)
  await engine.onStimulus({ kind: 'blunder', gameId: 1, scoreCp: -300, moveZh: '红炮二平五', tension: 0.95 })
  const afterFirst = out.length
  // 静默窗内(now 不变,距上条 < minSilenceMs)立刻提问 → coach_query 跳过限流闸,仍必答
  await engine.onStimulus({ kind: 'coach_query', gameId: 1, scoreCp: 40, humanText: '该走哪?', engineInsight: null, tension: 0.9 } as any)
  const replies = out.slice(afterFirst).filter((l: any) => l.personaId === 'coach' && l.addressee === 'human')
  expect(replies.length).toBe(1)
})
