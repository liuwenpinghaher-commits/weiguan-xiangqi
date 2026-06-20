import { test, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { PersonaMemoryRepo } from './persona-memory-repo.js'
import { FakeLLM } from '../llm/fake.js'
import { reflect } from './reflection.js'

test('反思:把若干 episode/fact 交给 LLM,产出 insight 写库', async () => {
  const repo = new PersonaMemoryRepo(openDb(':memory:'))
  repo.add({ personaId: 'coach', kind: 'fact', content: '残局丢相', importance: 3, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  repo.add({ personaId: 'coach', kind: 'fact', content: '残局又急了', importance: 3, gameId: 2, createdAt: '2026-06-20T01:00:00Z' })
  const llm = new FakeLLM(['这玩家逢残局必急躁,缺耐心'])
  await reflect({ repo, llm, personaId: 'coach', gameId: 2, now: () => Date.parse('2026-06-20T02:00:00Z') })
  const insights = repo.byPersona('coach').filter(m => m.kind === 'insight')
  expect(insights).toHaveLength(1)
  expect(insights[0].content).toMatch(/急躁/)
  expect(insights[0].importance).toBeGreaterThanOrEqual(4) // 洞见高权重
})

test('无记忆可反思时不调用 LLM、不写库', async () => {
  const repo = new PersonaMemoryRepo(openDb(':memory:'))
  const llm = new FakeLLM(['不该被调用'])
  await reflect({ repo, llm, personaId: 'coach', gameId: 1, now: () => 0 })
  expect(llm.calls).toHaveLength(0)
  expect(repo.byPersona('coach')).toHaveLength(0)
})
