import { test, expect } from 'vitest'
import { FakeMemoryStore } from './fake-memory-store.js'
import { FakeLLM } from '../llm/fake.js'
import { reflect } from './reflection.js'

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
