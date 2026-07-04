import { describe, it, expect } from 'vitest'
import Fastify, { type FastifyInstance } from 'fastify'
import { openDb } from '../store/db.js'
import { SettingsRepo } from '../store/settings-repo.js'
import { RuntimeConfig } from '../config/runtime-config.js'
import { GamesRepo } from '../store/games-repo.js'
import { MessagesRepo } from '../store/messages-repo.js'
import { FakeMemoryStore } from '../memory/fake-memory-store.js'
import { registerAdminRoutes } from './admin-routes.js'

function makeApp(): { app: FastifyInstance; cfg: RuntimeConfig; mem: FakeMemoryStore } {
  const db = openDb(':memory:')
  const cfg = new RuntimeConfig(new SettingsRepo(db), () => '2026-06-20T00:00:00.000Z')
  const mem = new FakeMemoryStore(() => 0)
  const app = Fastify()
  registerAdminRoutes(app, { cfg, mem, games: new GamesRepo(db), messages: new MessagesRepo(db) })
  return { app, cfg, mem }
}

describe('admin config 路由', () => {
  it('GET /admin/config 返回各段 + personas,且 llm.apiKey 脱敏', async () => {
    const { app, cfg } = makeApp()
    cfg.updateSection('llm', { apiKey: 'sk-abcdef1Xqy' })
    const res = await app.inject({ method: 'GET', url: '/admin/config' })
    expect(res.statusCode).toBe(200)
    const body = res.json<any>()
    expect(body.chat.maxPerMin).toBe(12)
    expect(body.llm.apiKey).toBe('sk-****1Xqy')
    expect(Array.isArray(body.personas)).toBe(true)
    expect(body.personas.length).toBeGreaterThan(0)
  })
  it('GET /admin/config/llm/reveal 返回完整 key', async () => {
    const { app, cfg } = makeApp()
    cfg.updateSection('llm', { apiKey: 'sk-abcdef1Xqy' })
    const res = await app.inject({ method: 'GET', url: '/admin/config/llm/reveal' })
    expect(res.json<any>().apiKey).toBe('sk-abcdef1Xqy')
  })
  it('PUT /admin/config/chat 校验并落库,GET 反映', async () => {
    const { app } = makeApp()
    const put = await app.inject({ method: 'PUT', url: '/admin/config/chat', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ speakThreshold: 0.9, bogus: 1 }) })
    expect(put.statusCode).toBe(200)
    const body = (await app.inject({ method: 'GET', url: '/admin/config' })).json<any>()
    expect(body.chat.speakThreshold).toBe(0.9)
    expect('bogus' in body.chat).toBe(false)
  })
  it('PUT 未知 section → 400', async () => {
    const { app } = makeApp()
    const res = await app.inject({ method: 'PUT', url: '/admin/config/bogus', headers: { 'content-type': 'application/json' }, payload: '{}' })
    expect(res.statusCode).toBe(400)
  })
})

describe('admin personas 路由', () => {
  it('GET /admin/personas 返回全部', async () => {
    const { app } = makeApp()
    const res = await app.inject({ method: 'GET', url: '/admin/personas' })
    expect(res.statusCode).toBe(200)
    expect(res.json<any[]>().length).toBeGreaterThan(0)
  })
  it('PUT /admin/personas/:id 改名/音色即时反映', async () => {
    const { app, cfg } = makeApp()
    const put = await app.inject({ method: 'PUT', url: '/admin/personas/coach', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ name: '林老师', ttsVoice: 'Cherry' }) })
    expect(put.statusCode).toBe(200)
    expect(cfg.personas().find(p => p.id === 'coach')!.name).toBe('林老师')
  })
  it('POST /admin/personas/:id/reset 恢复默认', async () => {
    const { app, cfg } = makeApp()
    await app.inject({ method: 'PUT', url: '/admin/personas/coach', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ name: 'X' }) })
    const res = await app.inject({ method: 'POST', url: '/admin/personas/coach/reset' })
    expect(res.statusCode).toBe(200)
    expect(cfg.personas().find(p => p.id === 'coach')!.name).toBe('林教练')
  })
  it('未知 persona id → 400', async () => {
    const { app } = makeApp()
    const res = await app.inject({ method: 'PUT', url: '/admin/personas/nope', headers: { 'content-type': 'application/json' }, payload: '{}' })
    expect(res.statusCode).toBe(400)
  })
})

describe('admin memory 路由(经 MemoryStore)', () => {
  it('GET /admin/memory?personaId= 列出;PUT 改;DELETE 删', async () => {
    const { app, mem } = makeApp()
    const id = await mem.record({ personaId: 'coach', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    const list = await app.inject({ method: 'GET', url: '/admin/memory?personaId=coach' })
    expect(list.json<any>().items).toHaveLength(1)
    expect(list.json<any>().degraded).toBe(true)  // FakeMemoryStore = 降级态

    const put = await app.inject({ method: 'PUT', url: `/admin/memory/${encodeURIComponent(id)}`, headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ content: '改打中炮' }) })
    expect(put.statusCode).toBe(200)
    expect((await mem.list({ personaId: 'coach' }))[0].content).toBe('改打中炮')

    const del = await app.inject({ method: 'DELETE', url: `/admin/memory/${encodeURIComponent(id)}` })
    expect(del.statusCode).toBe(200)
    expect(await mem.list({ personaId: 'coach' })).toHaveLength(0)
  })
  it('GET /admin/memory?personaId=<非法> → 400 unknown persona', async () => {
    const { app } = makeApp()
    const res = await app.inject({ method: 'GET', url: '/admin/memory?personaId=nobody' })
    expect(res.statusCode).toBe(400)
    expect(res.json<any>().error).toBe('unknown persona')
  })
  it('GET /admin/memory(不传 personaId)→ 不过滤,返回全部', async () => {
    const { app, mem } = makeApp()
    await mem.record({ personaId: 'coach', kind: 'fact', content: 'a', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    await mem.record({ personaId: 'netizen', kind: 'fact', content: 'b', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    const res = await app.inject({ method: 'GET', url: '/admin/memory' })
    expect(res.statusCode).toBe(200)
    expect(res.json<any>().items).toHaveLength(2)
  })
  it('GET /admin/memory?kind=fact 过滤', async () => {
    const { app, mem } = makeApp()
    await mem.record({ personaId: 'coach', kind: 'episode', content: 'e', importance: 1, gameId: null, createdAt: new Date(0).toISOString() })
    await mem.record({ personaId: 'coach', kind: 'fact', content: 'f', importance: 3, gameId: null, createdAt: new Date(0).toISOString() })
    const res = await app.inject({ method: 'GET', url: '/admin/memory?personaId=coach&kind=fact' })
    expect(res.json<any>().items.map((r: any) => r.kind)).toEqual(['fact'])
  })
})

describe('admin games 路由', () => {
  it('GET /admin/games 列表;GET /admin/games/:id 取详情;DELETE 级联删', async () => {
    const db2 = openDb(':memory:')
    const cfg2 = new RuntimeConfig(new SettingsRepo(db2), () => 't')
    const games = new GamesRepo(db2); const messages = new MessagesRepo(db2)
    const app = Fastify()
    registerAdminRoutes(app, { cfg: cfg2, mem: new FakeMemoryStore(() => 0), games, messages })
    const id = games.createGame({ mode: 'humanlike', humanSide: 'red', startFen: 'startpos', startedAt: 't0' })
    games.addMove({ gameId: id, side: 'red', move: 'h2e2', fenAfter: 'f', scoreCp: 10, byAi: false })
    messages.addMessage({ gameId: id, personaId: 'coach', role: 'persona', text: 'hi', addressee: null, ts: 't0' })

    const list = await app.inject({ method: 'GET', url: '/admin/games' })
    expect(list.json<any[]>().length).toBe(1)

    const detail = await app.inject({ method: 'GET', url: `/admin/games/${id}` })
    const d = detail.json<any>()
    expect(d.game.id).toBe(id); expect(d.moves).toHaveLength(1); expect(d.messages).toHaveLength(1)

    const del = await app.inject({ method: 'DELETE', url: `/admin/games/${id}` })
    expect(del.statusCode).toBe(200)
    expect((await app.inject({ method: 'GET', url: '/admin/games' })).json<any[]>()).toHaveLength(0)
  })
  it('GET /admin/games/:id 不存在 → 404', async () => {
    const { app } = makeApp()
    const res = await app.inject({ method: 'GET', url: '/admin/games/999' })
    expect(res.statusCode).toBe(404)
  })
})
