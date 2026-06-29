import { test, expect } from 'vitest'
import { FakeMemoryStore } from './fake-memory-store.js'
import { FakeLLM } from '../llm/fake.js'
import { reflect } from './reflection.js'
import type { Persona, PersonaId } from '../types.js'

// ─── 旧测试(保留并升级) ──────────────────────────────────────────────────────

test('playerSummary 为空 → 不调 LLM、不写库', async () => {
  const store = new FakeMemoryStore(() => 0)
  const llm = new FakeLLM(['不该被调用'])
  await reflect({
    store, llm, personaId: 'coach', gameId: 1,
    now: () => 0,
    playerSummary: '',
  })
  expect(llm.calls).toHaveLength(0)
  expect(await store.list({ personaId: 'coach' })).toHaveLength(0)
})

// ─── Step 1 新测试:反思同时产出 fact + insight ───────────────────────────────

test('标准格式:2 条 "- " fact + "洞见:" insight → 写入 ≥2 条 fact(importance 3)+ 1 条 insight(importance 4)', async () => {
  const store = new FakeMemoryStore(() => Date.parse('2026-06-20T02:00:00Z'))
  // FakeLLM 返回标准格式:两条 fact + 一条 insight
  const llmReply = '- 爱走当头炮\n- 残局易急躁\n洞见: 进攻型棋手,中局决断力强但残局失误多'
  const llm = new FakeLLM([llmReply])

  await reflect({
    store, llm, personaId: 'coach', gameId: 1,
    now: () => Date.parse('2026-06-20T02:00:00Z'),
    playerSummary: '红炮二平五;红马八进七;红车一平二',
  })

  const all = await store.list({ personaId: 'coach' })
  const facts = all.filter(m => m.kind === 'fact')
  const insights = all.filter(m => m.kind === 'insight')

  expect(facts.length).toBeGreaterThanOrEqual(2)
  expect(insights).toHaveLength(1)

  // fact importance = 3
  facts.forEach(f => expect(f.importance).toBe(3))
  // insight importance = 4
  expect(insights[0].importance).toBe(4)

  // 内容正确
  const factContents = facts.map(f => f.content)
  expect(factContents.some(c => c.includes('当头炮'))).toBe(true)
  expect(factContents.some(c => c.includes('急躁'))).toBe(true)
  expect(insights[0].content).toContain('进攻型')
})

test('容忍格式偏差:只有 "- " 行,无 "洞见:",则全部写成 fact', async () => {
  const store = new FakeMemoryStore(() => Date.parse('2026-06-20T03:00:00Z'))
  const llmReply = '- 开局喜欢飞象\n- 中局运子慢'
  const llm = new FakeLLM([llmReply])

  await reflect({
    store, llm, personaId: 'laopaoer', gameId: 2,
    now: () => Date.parse('2026-06-20T03:00:00Z'),
    playerSummary: '黑象3进5;黑马8进7',
  })

  const all = await store.list({ personaId: 'laopaoer' })
  const facts = all.filter(m => m.kind === 'fact')
  const insights = all.filter(m => m.kind === 'insight')

  expect(facts.length).toBeGreaterThanOrEqual(1)
  // 无 insight 也可(容忍格式)
  expect(insights.length).toBeLessThanOrEqual(1)
})

test('容忍格式偏差:LLM 返回散文(无 "- " 行无 "洞见:"),则整段写成 1 条 insight', async () => {
  const store = new FakeMemoryStore(() => Date.parse('2026-06-20T04:00:00Z'))
  const llmReply = '这位棋手整体水平偏弱,残局不稳'
  const llm = new FakeLLM([llmReply])

  await reflect({
    store, llm, personaId: 'netizen', gameId: 3,
    now: () => Date.parse('2026-06-20T04:00:00Z'),
    playerSummary: '红车一平二',
  })

  const all = await store.list({ personaId: 'netizen' })
  expect(all.length).toBeGreaterThanOrEqual(1)
  // 内容正确
  expect(all.some(m => m.content.includes('残局'))).toBe(true)
})

test('LLM 返回空字符串 → 不写库', async () => {
  const store = new FakeMemoryStore(() => 0)
  const llm = new FakeLLM([''])

  await reflect({
    store, llm, personaId: 'coach', gameId: 4,
    now: () => 0,
    playerSummary: '红炮二平五',
  })

  expect(await store.list({ personaId: 'coach' })).toHaveLength(0)
})

test('传入 getPersona(运行时覆盖)→ 反思 prompt 使用运行时 persona 的 name', async () => {
  const store = new FakeMemoryStore(() => 0)
  const llm = new FakeLLM(['- 爱走马\n洞见: 灵活棋手'])

  // 模拟控制台改了角色 name 的运行时 persona
  const runtimePersona: Persona = {
    id: 'coach', name: '改名教练', isPlayer: false, skill: 'medium',
    background: '运行时背景', voice: '运行时口吻', leaning: '运行时倾向',
  }
  const getPersona = (id: PersonaId): Persona => {
    expect(id).toBe('coach')
    return runtimePersona
  }

  await reflect({
    store, llm, personaId: 'coach', gameId: 6,
    now: () => 0,
    playerSummary: '红马八进七',
    getPersona,
  })

  expect(llm.calls).toHaveLength(1)
  const sys = llm.calls[0].messages.find(m => m.role === 'system')
  expect(sys?.content).toContain('改名教练')
  // 不应回退到静态 personas 的旧名(林教练)
  expect(sys?.content).not.toContain('林教练')
})

test('未传 getPersona → 回退静态 personas(系统 prompt 用静态 name)', async () => {
  const store = new FakeMemoryStore(() => 0)
  const llm = new FakeLLM(['- 爱走马\n洞见: 灵活棋手'])

  await reflect({
    store, llm, personaId: 'coach', gameId: 7,
    now: () => 0,
    playerSummary: '红马八进七',
  })

  const sys = llm.calls[0].messages.find(m => m.role === 'system')
  expect(sys?.content).toContain('林教练')
})

test('record 抛错被逐条隔离:中间一条失败不丢后续 entry', async () => {
  const recorded: string[] = []
  // 第二条 record 抛错,验证第一/第三条仍被写入(不被中断)。
  const flakyStore = {
    record: async (e: { content: string }) => {
      if (e.content === '残局易急躁') throw new Error('boom')
      recorded.push(e.content)
      return 'id'
    },
    list: async () => [],
  } as any
  const llm = new FakeLLM(['- 爱走当头炮\n- 残局易急躁\n洞见: 进攻型棋手'])

  await reflect({
    store: flakyStore, llm, personaId: 'coach', gameId: 9,
    now: () => 0,
    playerSummary: '红炮二平五',
  })

  // 失败的 "残局易急躁" 被跳过,但 fact "爱走当头炮" 与 insight "进攻型棋手" 仍写入。
  expect(recorded).toContain('爱走当头炮')
  expect(recorded.some(c => c.includes('进攻型'))).toBe(true)
  expect(recorded).not.toContain('残局易急躁')
})

test('只有一次 LLM 调用(单次 chat 请求)', async () => {
  const store = new FakeMemoryStore(() => 0)
  const llmReply = '- 爱走马\n洞见: 灵活棋手'
  const llm = new FakeLLM([llmReply])

  await reflect({
    store, llm, personaId: 'coach', gameId: 5,
    now: () => 0,
    playerSummary: '红马八进七',
  })

  expect(llm.calls).toHaveLength(1)
})
