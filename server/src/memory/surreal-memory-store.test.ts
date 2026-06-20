import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { Surreal } from 'surrealdb'
import { SurrealMemoryStore } from './surreal-memory-store.js'
import { FakeEmbedding } from '../llm/embedding.js'
import { FakeLLM } from '../llm/fake.js'

const BIN = join(homedir(), '.surrealdb', 'surreal')
const PORT = 8123
const URL = `ws://127.0.0.1:${PORT}`
const hasBin = existsSync(BIN)

// 不需要 surreal 二进制:验证连接到"接受 TCP 但不完成握手"的端点时,
// connect() 按 connectTimeoutMs 快速 reject(而非挂起),让 ws-server 能即时降级。
describe('SurrealMemoryStore 连接超时', () => {
  it('端点不响应握手时按 connectTimeoutMs 超时失败,不挂起', async () => {
    const sockets = new Set<net.Socket>()
    const server = net.createServer((s) => { sockets.add(s); s.on('close', () => sockets.delete(s)) })
    await new Promise<void>((res) => server.listen(0, '127.0.0.1', res))
    const port = (server.address() as net.AddressInfo).port
    const store = new SurrealMemoryStore({
      url: `ws://127.0.0.1:${port}`, namespace: 't', database: 't', username: 'root', password: 'root',
      embedding: new FakeEmbedding(16), llm: new FakeLLM(['keep']), now: () => 0, connectTimeoutMs: 300,
    })
    try {
      const t0 = Date.now()
      await expect(store.connect()).rejects.toThrow(/超时/)
      const dt = Date.now() - t0
      expect(dt).toBeGreaterThanOrEqual(250)
      expect(dt).toBeLessThan(3000)
    } finally {
      sockets.forEach((s) => s.destroy())
      await new Promise<void>((res) => server.close(() => res()))
    }
  }, 10000)
})

describe.skipIf(!hasBin)('SurrealMemoryStore (集成)', () => {
  let proc: ChildProcess
  let clock = Date.parse('2026-06-20T00:00:00.000Z')

  beforeAll(async () => {
    proc = spawn(BIN, ['start', 'memory', '--bind', `127.0.0.1:${PORT}`, '--user', 'root', '--pass', 'root'], { stdio: 'ignore' })
    for (let i = 0; i < 25; i++) {
      try { const db = new Surreal(); await db.connect(URL); await db.close(); break }
      catch { await new Promise(r => setTimeout(r, 200)) }
    }
  }, 15000)

  afterAll(() => { proc?.kill() })

  function makeStore(llm = new FakeLLM(['keep'])) {
    return new SurrealMemoryStore({
      url: URL, namespace: 'test', database: 'test', username: 'root', password: 'root',
      embedding: new FakeEmbedding(16), llm, now: () => clock, simThreshold: -1,
    })
  }

  it('record fact 后 retrieve 能语义召回,且 episode 不混入', async () => {
    const store = makeStore()
    await store.connect()
    await store.record({ personaId: 'coach', kind: 'episode', content: '这步软了', importance: 1, gameId: 1, createdAt: new Date(clock).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: new Date(clock).toISOString() })
    const got = await store.retrieve('coach', '残局急躁', 5, ['fact', 'insight'])
    expect(got).toHaveLength(1)
    expect(got[0].content).toBe('残局易急躁')
    await store.close()
  })

  it('judge=supersede 时旧条作废、retrieve 不再返回、list(includeSuperseded) 仍可见', async () => {
    const store = makeStore(new FakeLLM(['supersede']))
    await store.connect()
    await store.record({ personaId: 'laopaoer', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: new Date(clock).toISOString() })
    await store.record({ personaId: 'laopaoer', kind: 'fact', content: '残局已变稳健', importance: 3, gameId: 2, createdAt: new Date(clock).toISOString() })
    const active = await store.retrieve('laopaoer', '残局', 5, ['fact'])
    expect(active.map(r => r.content)).toContain('残局已变稳健')
    expect(active.map(r => r.content)).not.toContain('残局易急躁')
    const all = await store.list({ personaId: 'laopaoer', includeSuperseded: true })
    expect(all.some(r => r.content === '残局易急躁' && r.supersededAt)).toBe(true)
    await store.close()
  })

  it('update 改 content 后能用新内容召回;remove 真删', async () => {
    const store = makeStore()
    await store.connect()
    const id = await store.record({ personaId: 'netizen', kind: 'fact', content: '偏好屏风马', importance: 3, gameId: null, createdAt: new Date(clock).toISOString() })
    await store.update(id, { content: '改打中炮' })
    expect((await store.list({ personaId: 'netizen' }))[0].content).toBe('改打中炮')
    await store.remove(id)
    expect(await store.list({ personaId: 'netizen' })).toHaveLength(0)
    await store.close()
  })

  it('嵌入失败降级:照存(embedding=NONE)、retrieve 退回 recency 不崩', async () => {
    const failing = { embed: async () => { throw new Error('boom') }, dimension: 16 }
    const store = new SurrealMemoryStore({
      url: URL, namespace: 'test', database: 'test2', username: 'root', password: 'root',
      embedding: failing as any, llm: new FakeLLM(['keep']), now: () => clock, simThreshold: -1,
    })
    await store.connect()
    const id = await store.record({ personaId: 'player', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: null, createdAt: new Date(clock).toISOString() })
    expect(id).toBeTruthy()
    const got = await store.retrieve('player', '当头炮', 5, ['fact'])
    expect(got).toHaveLength(1)
    await store.close()
  })
})
