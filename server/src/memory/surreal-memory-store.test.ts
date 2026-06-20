import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Surreal } from 'surrealdb'
import { SurrealMemoryStore } from './surreal-memory-store.js'
import { FakeEmbedding } from '../llm/embedding.js'
import { FakeLLM } from '../llm/fake.js'

const BIN = join(homedir(), '.surrealdb', 'surreal')
const PORT = 8123
const URL = `ws://127.0.0.1:${PORT}`
const hasBin = existsSync(BIN)

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
    await store.record({ personaId: 'p1', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: new Date(clock).toISOString() })
    await store.record({ personaId: 'p1', kind: 'fact', content: '残局已变稳健', importance: 3, gameId: 2, createdAt: new Date(clock).toISOString() })
    const active = await store.retrieve('p1', '残局', 5, ['fact'])
    expect(active.map(r => r.content)).toContain('残局已变稳健')
    expect(active.map(r => r.content)).not.toContain('残局易急躁')
    const all = await store.list({ personaId: 'p1', includeSuperseded: true })
    expect(all.some(r => r.content === '残局易急躁' && r.supersededAt)).toBe(true)
    await store.close()
  })

  it('update 改 content 后能用新内容召回;remove 真删', async () => {
    const store = makeStore()
    await store.connect()
    const id = await store.record({ personaId: 'p2', kind: 'fact', content: '偏好屏风马', importance: 3, gameId: null, createdAt: new Date(clock).toISOString() })
    await store.update(id, { content: '改打中炮' })
    expect((await store.list({ personaId: 'p2' }))[0].content).toBe('改打中炮')
    await store.remove(id)
    expect(await store.list({ personaId: 'p2' })).toHaveLength(0)
    await store.close()
  })

  it('嵌入失败降级:照存(embedding=NONE)、retrieve 退回 recency 不崩', async () => {
    const failing = { embed: async () => { throw new Error('boom') }, dimension: 16 }
    const store = new SurrealMemoryStore({
      url: URL, namespace: 'test', database: 'test2', username: 'root', password: 'root',
      embedding: failing as any, llm: new FakeLLM(['keep']), now: () => clock, simThreshold: -1,
    })
    await store.connect()
    const id = await store.record({ personaId: 'p3', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: null, createdAt: new Date(clock).toISOString() })
    expect(id).toBeTruthy()
    const got = await store.retrieve('p3', '当头炮', 5, ['fact'])
    expect(got).toHaveLength(1)
    await store.close()
  })
})
