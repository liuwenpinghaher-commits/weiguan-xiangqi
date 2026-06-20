import { test, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { PersonaMemoryRepo } from './persona-memory-repo.js'
import { FakeLLM } from '../llm/fake.js'
import { reflect } from './reflection.js'

test('有 playerSummary → 产出关于玩家的 insight 写库', async () => {
  const repo = new PersonaMemoryRepo(openDb(':memory:'))
  const llm = new FakeLLM(['逢残局易急躁'])
  await reflect({
    repo, llm, personaId: 'coach', gameId: 1,
    now: () => Date.parse('2026-06-20T02:00:00Z'),
    playerSummary: '红炮二平五;红马八进七;红车一平二',
  })
  const insights = repo.byPersona('coach').filter(m => m.kind === 'insight')
  expect(insights).toHaveLength(1)
  expect(insights[0].content).toMatch(/急躁/)
  expect(insights[0].importance).toBeGreaterThanOrEqual(4)
})

test('playerSummary 为空 → 不调 LLM、不写库', async () => {
  const repo = new PersonaMemoryRepo(openDb(':memory:'))
  const llm = new FakeLLM(['不该被调用'])
  await reflect({
    repo, llm, personaId: 'coach', gameId: 1,
    now: () => 0,
    playerSummary: '',
  })
  expect(llm.calls).toHaveLength(0)
  expect(repo.byPersona('coach')).toHaveLength(0)
})
