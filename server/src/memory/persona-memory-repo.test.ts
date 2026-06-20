import { test, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { PersonaMemoryRepo } from './persona-memory-repo.js'

function repo() { return new PersonaMemoryRepo(openDb(':memory:')) }

test('add + 按角色取回', () => {
  const r = repo()
  r.add({ personaId: 'coach', kind: 'fact', content: '你爱走中炮', importance: 3, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  const all = r.byPersona('coach')
  expect(all).toHaveLength(1)
  expect(all[0].content).toBe('你爱走中炮')
})

test('检索按 recency+importance+relevance 排序,关键词命中加权', () => {
  const r = repo()
  r.add({ personaId: 'coach', kind: 'fact', content: '残局总是急躁', importance: 5, gameId: 1, createdAt: '2026-06-01T00:00:00Z' })
  r.add({ personaId: 'coach', kind: 'fact', content: '喜欢喝茶', importance: 1, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  const top = r.retrieve('coach', '残局怎么走', 1, () => new Date('2026-06-20T00:00:00Z').getTime())
  expect(top[0].content).toBe('残局总是急躁')
})

test('retrieve 限制条数', () => {
  const r = repo()
  for (let i = 0; i < 5; i++) r.add({ personaId: 'coach', kind: 'fact', content: 'c' + i, importance: 1, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  expect(r.retrieve('coach', 'x', 2, () => Date.parse('2026-06-20T00:00:00Z'))).toHaveLength(2)
})

test('retrieve 按 kinds 过滤:只回指定 kind 的记录', () => {
  const r = repo()
  const now = () => Date.parse('2026-06-20T00:00:00Z')
  r.add({ personaId: 'coach', kind: 'episode', content: '角色自己说的话x', importance: 1, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  r.add({ personaId: 'coach', kind: 'fact', content: '玩家爱走中炮x', importance: 3, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  const results = r.retrieve('coach', 'x', 5, now, ['fact'])
  expect(results).toHaveLength(1)
  expect(results[0].kind).toBe('fact')
  expect(results[0].content).toBe('玩家爱走中炮x')
})
