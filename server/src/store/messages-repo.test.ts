import { test, expect } from 'vitest'
import { openDb } from './db.js'
import { GamesRepo } from './games-repo.js'
import { MessagesRepo } from './messages-repo.js'

function setup() {
  const db = openDb(':memory:')
  const games = new GamesRepo(db)
  const messages = new MessagesRepo(db)
  const gameId = games.createGame({ mode: 'coach', humanSide: 'red', startFen: 'FEN', startedAt: '2026-06-20T00:00:00Z' })
  return { games, messages, gameId }
}

test('addMessage 返回自增 id', () => {
  const { messages, gameId } = setup()
  const id = messages.addMessage({ gameId, personaId: 'laopaoer', role: 'persona', text: '好棋!', addressee: 'all', ts: '2026-06-20T01:00:00Z' })
  expect(id).toBeGreaterThan(0)
})

test('getMessages 按 id 升序取回 persona + human 两条,字段正确', () => {
  const { messages, gameId } = setup()
  messages.addMessage({ gameId, personaId: 'laopaoer', role: 'persona', text: '妙手', addressee: 'human', ts: '2026-06-20T01:00:00Z' })
  messages.addMessage({ gameId, personaId: 'human', role: 'human', text: '谢谢', addressee: 'all', ts: '2026-06-20T01:01:00Z' })

  const rows = messages.getMessages(gameId)
  expect(rows).toHaveLength(2)

  const [first, second] = rows
  expect(first.personaId).toBe('laopaoer')
  expect(first.role).toBe('persona')
  expect(first.text).toBe('妙手')
  expect(first.addressee).toBe('human')
  expect(first.ts).toBe('2026-06-20T01:00:00Z')

  expect(second.personaId).toBe('human')
  expect(second.role).toBe('human')
  expect(second.text).toBe('谢谢')
  expect(second.addressee).toBe('all')
  // 第二条 id 比第一条大(升序)
  expect(second.id).toBeGreaterThan(first.id)
})

test('getMessages 跨局隔离:只返回目标局的消息', () => {
  const db = openDb(':memory:')
  const games = new GamesRepo(db)
  const messages = new MessagesRepo(db)

  const game1 = games.createGame({ mode: 'coach', humanSide: 'red', startFen: 'F', startedAt: 't1' })
  const game2 = games.createGame({ mode: 'humanlike', humanSide: 'black', startFen: 'F', startedAt: 't2' })

  messages.addMessage({ gameId: game1, personaId: 'netizen', role: 'persona', text: '局1发言', addressee: 'all', ts: 'T1' })
  messages.addMessage({ gameId: game2, personaId: 'coach', role: 'persona', text: '局2发言', addressee: 'all', ts: 'T2' })

  const msgs1 = messages.getMessages(game1)
  const msgs2 = messages.getMessages(game2)

  expect(msgs1).toHaveLength(1)
  expect(msgs1[0].text).toBe('局1发言')

  expect(msgs2).toHaveLength(1)
  expect(msgs2[0].text).toBe('局2发言')
})

test('getMessages 空局返回空数组', () => {
  const { messages, gameId } = setup()
  expect(messages.getMessages(gameId)).toEqual([])
})

test('getMessages addressee 可为 null', () => {
  const { messages, gameId } = setup()
  messages.addMessage({ gameId, personaId: 'laopaoer', role: 'persona', text: '随便说', addressee: undefined, ts: 'T' })
  const rows = messages.getMessages(gameId)
  expect(rows[0].addressee).toBeNull()
})
