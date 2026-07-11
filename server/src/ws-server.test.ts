/**
 * ws-server 集成测试
 *
 * 策略：真实 Position + 假引擎(fakeEngine) + FakeLLM
 *  - fakeEngine.analyze(fen) 调用真实 Position.fromFen(fen).legalMoves() 确保合法着法
 *  - FakeLLM 返回固定文本，不依赖外部服务
 *  - HTTP 路由用 app.inject；WebSocket 用真实 listen + ws 客户端
 *
 * 守护路径：
 *  1. GET /games/:id 404
 *  2. POST /games/import + GET /games/:id/export 棋谱导入导出
 *  3. GET /export 全库导出
 *  4. WS /play：new → move 一回合闭环（aiMove 合法、FEN 变化、无 error）
 */

import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import WebSocket from 'ws'
import type { FastifyInstance } from 'fastify'
import { buildServer } from './ws-server.js'
import { FakeLLM } from './llm/fake.js'
import { Position } from './rules/position.js'
import type { EngineLine } from './types.js'

// ──────────────────────────────────────────────────────────────────────────────
// 假引擎：analyze 用真实 Position 取合法着法，返回至少 1 条 EngineLine
// ──────────────────────────────────────────────────────────────────────────────
const fakeEngine = {
  async analyze(fen: string, _opts?: { multipv: number; movetime?: number }): Promise<EngineLine[]> {
    const legal = Position.fromFen(fen).legalMoves()
    if (legal.length === 0) throw new Error('no legal moves')
    // 最多返回 5 条（与 GameSession MULTIPV=5 对齐），保证 selectMove 有足够候选
    const take = Math.min(5, legal.length)
    return legal.slice(0, take).map((move, i) => ({
      multipv: i + 1,
      move,
      scoreCp: 30 - i * 5,   // 递减分，第 1 条最优
      mate: null,
      pv: [move],
    }))
  },
}

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

// ──────────────────────────────────────────────────────────────────────────────
// 工具：等待特定 type 的 WS 消息（跳过 chat 等噪音），超时则 reject
// ──────────────────────────────────────────────────────────────────────────────
function waitForMessage(
  ws: WebSocket,
  type: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`waitForMessage(type=${type}) timeout after ${timeoutMs}ms`)),
      timeoutMs,
    )
    const onMessage = (raw: Buffer | string) => {
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(raw.toString()) as Record<string, unknown>
      } catch (e) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        reject(e)
        return
      }
      if (parsed.type === type) {
        clearTimeout(timer)
        ws.off('message', onMessage)
        resolve(parsed)
      }
      // 其他类型(如 chat)直接忽略,继续监听
    }
    ws.on('message', onMessage)
    ws.once('error', (err) => {
      clearTimeout(timer)
      ws.off('message', onMessage)
      reject(err)
    })
  })
}

// ──────────────────────────────────────────────────────────────────────────────
// 工具：等待 WS 连接建立
// ──────────────────────────────────────────────────────────────────────────────
function wsOpen(ws: WebSocket, timeoutMs = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ws.readyState === WebSocket.OPEN) { resolve(); return }
    const timer = setTimeout(() => reject(new Error('WS open timeout')), timeoutMs)
    ws.once('open', () => { clearTimeout(timer); resolve() })
    ws.once('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

// ──────────────────────────────────────────────────────────────────────────────
describe('ws-server 集成测试', () => {
  let app: FastifyInstance
  let wsClient: WebSocket | null = null

  afterEach(async () => {
    // 先关 WS 客户端，再关 Fastify（避免悬挂连接导致 close 挂起）
    if (wsClient) {
      const wc = wsClient
      wsClient = null
      wc.terminate()
    }
    if (app) {
      await app.close()
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────
  // 辅助：构造带注入依赖的 app
  // ─────────────────────────────────────────────────────────────────────────────
  async function makeApp() {
    const llm = new FakeLLM(() => '老炮儿：这步有点意思')
    return buildServer({ dbPath: ':memory:', engine: fakeEngine, llm })
  }

  // ──────────────────────────────────────────────────────────────────────────
  // HTTP 测试
  // ──────────────────────────────────────────────────────────────────────────

  it('GET /games/1 → 404（空库）', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/games/1' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /games/:id/diagnosis 非法 id → 400', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/games/abc/diagnosis' })
    expect(res.statusCode).toBe(400)
    expect(res.json<any>().error).toBe('invalid id')
  })

  it('GET /games/:id/drills 非法 id → 400', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/games/abc/drills' })
    expect(res.statusCode).toBe(400)
    expect(res.json<any>().error).toBe('invalid id')
  })

  it('GET /admin/config 经 buildServer 挂载可用', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/admin/config' })
    expect(res.statusCode).toBe(200)
    expect(res.json<any>().chat.maxPerMin).toBe(12)
  })

  it('GET /engine/status 暴露引擎配置/降级状态', async () => {
    app = await buildServer({ dbPath: ':memory:', engine: null, llm: new FakeLLM(() => 'x') })
    const noEngine = await app.inject({ method: 'GET', url: '/engine/status' })
    expect(noEngine.statusCode).toBe(200)
    expect(noEngine.json<any>()).toMatchObject({ configured: false, degraded: true })

    await app.close()
    app = await makeApp()
    const ok = await app.inject({ method: 'GET', url: '/engine/status' })
    expect(ok.statusCode).toBe(200)
    expect(ok.json<any>()).toMatchObject({ configured: true, degraded: false })
  })

  it('POST /games/import 导入棋谱，GET /games/:id/export 能取回', async () => {
    app = await makeApp()

    // 导入两步合法开局着法（红方、黑方各一步）
    const body = { moves: ['h2e2', 'b9c7'] }
    const importRes = await app.inject({
      method: 'POST',
      url: '/games/import',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(body),
    })
    expect(importRes.statusCode).toBe(200)
    const { gameId } = importRes.json<{ gameId: number }>()
    expect(typeof gameId).toBe('number')

    // 单局导出
    const exportRes = await app.inject({ method: 'GET', url: `/games/${gameId}/export` })
    expect(exportRes.statusCode).toBe(200)
    const exported = exportRes.json<{ moves: string[] }>()
    expect(exported.moves).toContain('h2e2')
  })

  it('GET /export 全库导出，包含刚导入的对局', async () => {
    app = await makeApp()

    const importRes = await app.inject({
      method: 'POST',
      url: '/games/import',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ moves: ['h2e2'] }),
    })
    expect(importRes.statusCode).toBe(200)

    const allRes = await app.inject({ method: 'GET', url: '/export' })
    expect(allRes.statusCode).toBe(200)
    const { games } = allRes.json<{ games: unknown[] }>()
    expect(Array.isArray(games)).toBe(true)
    expect(games.length).toBeGreaterThanOrEqual(1)
  })

  it('GET /export 明确声明导出范围,避免被误当完整备份', async () => {
    app = await makeApp()
    const res = await app.inject({ method: 'GET', url: '/export' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ scope?: string; includes?: string[]; excludes?: string[] }>()
    expect(body.scope).toBe('games-only')
    expect(body.includes).toEqual(['games', 'moves'])
    expect(body.excludes).toEqual(expect.arrayContaining(['move_annotations', 'growth_metrics', 'drill_attempts', 'messages', 'memory', 'app_settings', 'persona_config']))
  })

  it('POST /games/import 传非法 moves → 400', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/games/import',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ moves: 'not-an-array' }),
    })
    expect(res.statusCode).toBe(400)
  })

  it('POST /games/import 写库阶段失败会回滚 game 行', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'weiguan-import-'))
    const dbPath = join(dir, 'test.sqlite')
    app = await buildServer({ dbPath, engine: fakeEngine, llm: new FakeLLM(() => 'x') })
    const { default: Database } = await import('better-sqlite3')
    const db = new Database(dbPath)
    try {
      db.exec(`
        CREATE TRIGGER fail_move_insert
        BEFORE INSERT ON moves
        BEGIN
          SELECT RAISE(ABORT, 'forced move insert failure');
        END;
      `)
      const res = await app.inject({
        method: 'POST',
        url: '/games/import',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ moves: ['h2e2'] }),
      })
      expect(res.statusCode).toBe(500)
      const row = db.prepare('SELECT COUNT(*) AS n FROM games').get() as { n: number }
      expect(row.n).toBe(0)
    } finally {
      db.close()
    }
  })

  it('GET /games/:id/diagnosis 未诊断时返回 pending 状态', async () => {
    app = await makeApp()
    const importRes = await app.inject({
      method: 'POST',
      url: '/games/import',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ moves: ['h2e2'] }),
    })
    const { gameId } = importRes.json<{ gameId: number }>()

    const diagnosis = await app.inject({ method: 'GET', url: `/games/${gameId}/diagnosis` })
    expect(diagnosis.statusCode).toBe(200)
    expect(diagnosis.json<any>().diagnosisStatus).toMatchObject({ status: 'pending' })
  })

  it('POST /games/:id/diagnose 失败后暴露 failed 状态,不伪装成 404 或空数据', async () => {
    const failingEngine = {
      async analyze(): Promise<EngineLine[]> {
        throw new Error('engine boom')
      },
    }
    app = await buildServer({ dbPath: ':memory:', engine: failingEngine, llm: new FakeLLM(() => 'x') })
    const importRes = await app.inject({
      method: 'POST',
      url: '/games/import',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ moves: ['h2e2'] }),
    })
    const { gameId } = importRes.json<{ gameId: number }>()

    const diagnose = await app.inject({ method: 'POST', url: `/games/${gameId}/diagnose` })
    expect(diagnose.statusCode).toBe(500)
    expect(diagnose.json<any>().diagnosisStatus).toMatchObject({ status: 'failed' })

    const diagnosis = await app.inject({ method: 'GET', url: `/games/${gameId}/diagnosis` })
    expect(diagnosis.statusCode).toBe(200)
    expect(diagnosis.json<any>().diagnosisStatus).toMatchObject({ status: 'failed' })
    expect(diagnosis.json<any>().diagnosisStatus.error).toContain('engine boom')
  })

  it('POST /games/:id/diagnose 成功后 GET diagnosis 返回 ok 状态', async () => {
    app = await makeApp()
    const importRes = await app.inject({
      method: 'POST',
      url: '/games/import',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ moves: ['h2e2'] }),
    })
    const { gameId } = importRes.json<{ gameId: number }>()

    const diagnose = await app.inject({ method: 'POST', url: `/games/${gameId}/diagnose` })
    expect(diagnose.statusCode).toBe(200)

    const diagnosis = await app.inject({ method: 'GET', url: `/games/${gameId}/diagnosis` })
    expect(diagnosis.json<any>().diagnosisStatus).toMatchObject({ status: 'ok' })
    expect(diagnosis.json<any>().annotations.length).toBeGreaterThan(0)
  })

  // ──────────────────────────────────────────────────────────────────────────
  // WebSocket 端到端对弈测试（"机器能转"守护测试）
  // ──────────────────────────────────────────────────────────────────────────

  it('WS /play：new → move 一回合闭环（aiMove 合法、FEN 变化）', async () => {
    app = await makeApp()
    // 监听端口（port:0 由 OS 分配）
    await app.listen({ port: 0, host: '127.0.0.1' })

    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const port = addr.port

    const ws = new WebSocket(`ws://127.0.0.1:${port}/play`)
    wsClient = ws
    await wsOpen(ws)

    // 1. 发 new 消息（等待 started，跳过可能的 chat 消息）
    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number
    expect(typeof gameId).toBe('number')

    // 2. 发人类走子（红方合法首着），等待 update，跳过 chat
    const humanMove = 'h2e2'
    ws.send(JSON.stringify({ type: 'move', gameId, move: humanMove }))
    const update = await waitForMessage(ws, 'update')

    // 断言核心字段
    expect(update.type).toBe('update')
    expect(typeof update.aiMove).toBe('string')
    expect(typeof update.fen).toBe('string')
    expect(update.over).toBe(false)

    // 断言 aiMove 是合法着（在 update.fen 对应 Position 走子前的合法着法中验证：
    // update.fen 是 AI 走后的局面，所以从 AI 走前局面校验——
    // 最简单验证：AI 走后的局面用 Position.fromFen 能解析且不报错）
    const afterFen = update.fen as string
    const afterPos = Position.fromFen(afterFen)
    // FEN 已变化（不再是初始局面）
    expect(afterFen).not.toBe(START_FEN)
    // AI 走后是黑方行棋（红先→AI黑→现在轮红，即下一步是红方，sideToMove='red'）
    // 实际：人类走红，AI 走黑，轮到红方
    expect(afterPos.sideToMove()).toBe('red')
    // 合法着法非空（局面合法、未结束）
    expect(afterPos.legalMoves().length).toBeGreaterThan(0)

    // 断言 aiMove 是合法棋子格式 [a-i][0-9][a-i][0-9]
    expect((update.aiMove as string)).toMatch(/^[a-i][0-9][a-i][0-9]$/)
  }, 10_000)

  it('WS /play：say 把用户自己的话回显为 chat(personaId=human)', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/play`)
    wsClient = ws
    await wsOpen(ws)

    const chats: Array<Record<string, unknown>> = []
    ws.on('message', (raw: Buffer | string) => {
      const m = JSON.parse(raw.toString()) as Record<string, unknown>
      if (m.type === 'chat') chats.push(m)
    })

    ws.send(JSON.stringify({ type: 'say', gameId: 1, text: '这步我觉得不错' }))
    await new Promise((r) => setTimeout(r, 800))

    const echo = chats.find((m) => m.personaId === 'human')
    expect(echo, '用户消息应被回显为 chat(personaId=human)').toBeTruthy()
    expect(echo!.text).toBe('这步我觉得不错')
  }, 10_000)

  it('WS /play：发送非法着法 → 收到 error 消息', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })

    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const port = addr.port

    const ws = new WebSocket(`ws://127.0.0.1:${port}/play`)
    wsClient = ws
    await wsOpen(ws)

    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number

    // 发一个非法着法（炮走到不合法位置），等待 error 消息，跳过 chat
    ws.send(JSON.stringify({ type: 'move', gameId, move: 'a0a9' }))
    const errMsg = await waitForMessage(ws, 'error')
    expect(typeof errMsg.message).toBe('string')
  }, 10_000)

  it('WS /play：unknown message type → error', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })

    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const port = addr.port

    const ws = new WebSocket(`ws://127.0.0.1:${port}/play`)
    wsClient = ws
    await wsOpen(ws)

    ws.send(JSON.stringify({ type: 'unknown_xyz' }))
    const errMsg = await waitForMessage(ws, 'error')
    expect(errMsg.type).toBe('error')
  }, 10_000)

  it('POST /asr 注入 FakeAsr → 返回转写文字', async () => {
    const { FakeAsr } = await import('./voice/asr.js')
    app = await buildServer({ dbPath: ':memory:', engine: fakeEngine, llm: new FakeLLM(() => 'x'), asr: new FakeAsr('当头炮') })
    const res = await app.inject({
      method: 'POST', url: '/asr?mime=audio/wav',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('fake-wav-bytes'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json<{ text: string }>().text).toBe('当头炮')
  })

  it('POST /asr 无 DASHSCOPE key 且未注入 asr → 503', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST', url: '/asr?mime=audio/wav',
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('x'),
    })
    expect(res.statusCode).toBe(503)
  })

  it('POST /asr:chat 模型配了 key 但无 DASHSCOPE env → 仍 503(凭据不复用 chat)', async () => {
    const savedKey = process.env.DASHSCOPE_API_KEY
    delete process.env.DASHSCOPE_API_KEY
    try {
      app = await buildServer({ dbPath: ':memory:', engine: fakeEngine, llm: new FakeLLM(() => 'x') })
      // 模拟控制台把 chat 模型换成与 DASHSCOPE 无关的凭据(如 DeepSeek):cfg.getLlm() 会返回这组值,
      // 但 /asr 现在只认 dashscopeAsrCreds()(纯读 DASHSCOPE env),不会读到这里 —— 这正是本用例要证明的。
      const put = await app.inject({
        method: 'PUT', url: '/admin/config/llm',
        headers: { 'content-type': 'application/json' },
        payload: JSON.stringify({ apiKey: 'sk-fake-deepseek', model: 'deepseek-chat', baseURL: 'https://api.deepseek.example.invalid/v1' }),
      })
      expect(put.statusCode).toBe(200)
      const res = await app.inject({
        method: 'POST', url: '/asr?mime=audio/wav',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('x'),
      })
      expect(res.statusCode).toBe(503)
    } finally {
      // savedKey 为 undefined 时必须 delete;直接赋值会把 env 设成字符串 "undefined"(真值),毒化后续测试。
      if (savedKey === undefined) delete process.env.DASHSCOPE_API_KEY
      else process.env.DASHSCOPE_API_KEY = savedKey
    }
  })

  it('POST /asr 非法 mime → 400', async () => {
    const { FakeAsr } = await import('./voice/asr.js')
    app = await buildServer({ dbPath: ':memory:', engine: fakeEngine, llm: new FakeLLM(() => 'x'), asr: new FakeAsr('当头炮') })
    const res = await app.inject({
      method: 'POST', url: '/asr?mime=' + encodeURIComponent('audio/wav\nevil'),
      headers: { 'content-type': 'application/octet-stream' },
      payload: Buffer.from('x'),
    })
    expect(res.statusCode).toBe(400)
  })

  it('WS /play:暂停后 say 不产生任何 chat 广播', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/play`)
    wsClient = ws
    await wsOpen(ws)
    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number

    ws.send(JSON.stringify({ type: 'pause', gameId }))
    await new Promise((r) => setTimeout(r, 100))

    const chats: Array<Record<string, unknown>> = []
    ws.on('message', (raw: Buffer | string) => {
      const m = JSON.parse(raw.toString()) as Record<string, unknown>
      if (m.type === 'chat') chats.push(m)
    })
    ws.send(JSON.stringify({ type: 'say', gameId, text: '暂停期间说话' }))
    await new Promise((r) => setTimeout(r, 600))
    expect(chats).toHaveLength(0)
  }, 10_000)

  it('WS /play:暂停后 resync 返回 paused=true', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/play`)
    wsClient = ws
    await wsOpen(ws)
    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number

    ws.send(JSON.stringify({ type: 'pause', gameId }))
    ws.send(JSON.stringify({ type: 'resync', gameId }))
    const state = await waitForMessage(ws, 'state')
    expect(state.paused).toBe(true)
    expect(state.spectators).toBe(true)
    expect(state.awaitingAi).toBe(false)
    expect(state.undoRemaining).toBe(3)
  }, 10_000)

  it('WS /play:暂停态走子返回明确 error,不静默丢帧', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/play`)
    wsClient = ws
    await wsOpen(ws)
    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number

    ws.send(JSON.stringify({ type: 'pause', gameId }))
    ws.send(JSON.stringify({ type: 'move', gameId, move: 'h2e2' }))
    const err = await waitForMessage(ws, 'error', 1000)
    expect(String(err.message)).toContain('对局已暂停')
  }, 10_000)

  it('WS /play:resume 后 say 恢复回显', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/play`)
    wsClient = ws
    await wsOpen(ws)
    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number

    ws.send(JSON.stringify({ type: 'pause', gameId }))
    ws.send(JSON.stringify({ type: 'resume', gameId }))
    await new Promise((r) => setTimeout(r, 50))

    const chats: Array<Record<string, unknown>> = []
    ws.on('message', (raw: Buffer | string) => {
      const m = JSON.parse(raw.toString()) as Record<string, unknown>
      if (m.type === 'chat') chats.push(m)
    })
    ws.send(JSON.stringify({ type: 'say', gameId, text: '继续了' }))
    await new Promise((r) => setTimeout(r, 500))
    expect(chats.some((m) => m.personaId === 'human' && m.text === '继续了')).toBe(true)
  }, 10_000)

  it('WS /play:关闭观众席后 say 仍回显玩家自己的话,但无角色回应', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/play`)
    wsClient = ws
    await wsOpen(ws)
    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number

    ws.send(JSON.stringify({ type: 'spectators', gameId, enabled: false }))
    await new Promise((r) => setTimeout(r, 100))

    const chats: Array<Record<string, unknown>> = []
    ws.on('message', (raw: Buffer | string) => {
      const m = JSON.parse(raw.toString()) as Record<string, unknown>
      if (m.type === 'chat') chats.push(m)
    })
    ws.send(JSON.stringify({ type: 'say', gameId, text: '观众席关了说话' }))
    await new Promise((r) => setTimeout(r, 600))
    // 玩家自己的话照常回显+落库(不再被吞),但观棋者不接话
    expect(chats.filter((m) => m.personaId === 'human')).toHaveLength(1)
    expect(chats.filter((m) => m.personaId !== 'human')).toHaveLength(0)
  }, 10_000)

  it('WS /play:关闭再开启观众席,say 恢复回显', async () => {
    app = await makeApp()
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const ws = new WebSocket(`ws://127.0.0.1:${addr.port}/play`)
    wsClient = ws
    await wsOpen(ws)
    ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN }))
    const started = await waitForMessage(ws, 'started')
    const gameId = started.gameId as number

    ws.send(JSON.stringify({ type: 'spectators', gameId, enabled: false }))
    ws.send(JSON.stringify({ type: 'spectators', gameId, enabled: true }))
    await new Promise((r) => setTimeout(r, 50))

    const chats: Array<Record<string, unknown>> = []
    ws.on('message', (raw: Buffer | string) => {
      const m = JSON.parse(raw.toString()) as Record<string, unknown>
      if (m.type === 'chat') chats.push(m)
    })
    ws.send(JSON.stringify({ type: 'say', gameId, text: '又开了' }))
    await new Promise((r) => setTimeout(r, 500))
    expect(chats.some((m) => m.personaId === 'human' && m.text === '又开了')).toBe(true)
  }, 10_000)

  it('玩家 say → 触发 coach_query,教练结合局面回答(addressee=human)', async () => {
    const engine = { analyze: async () => [{ multipv: 1, move: 'h2e2', scoreCp: 40, mate: null, pv: ['h2e2'] }] }
    app = await buildServer({ dbPath: ':memory:', engine, llm: new FakeLLM(() => '教练:这步稳,先出直车') })
    await app.listen({ port: 0, host: '127.0.0.1' })
    const addr = app.server.address()
    if (!addr || typeof addr === 'string') throw new Error('unexpected address type')
    const port = addr.port
    const got: any[] = []
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/play`)
      wsClient = ws
      ws.on('open', () => ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red' })))
      ws.on('message', (raw: any) => {
        const m = JSON.parse(raw.toString())
        if (m.type === 'started') ws.send(JSON.stringify({ type: 'say', gameId: m.gameId, text: '我这步该走哪?' }))
        else if (m.type === 'chat' && m.addressee === 'human' && m.personaId === 'coach') { got.push(m); ws.close(); resolve() }
      })
      ws.on('error', reject)
      setTimeout(() => reject(new Error('超时:未收到教练回答')), 8000)
    })
    expect(got.length).toBeGreaterThanOrEqual(1)
  }, 12_000)

  it('POST /tts 拒绝非本地前端 Origin,避免跨站白烧 TTS', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'POST',
      url: '/tts',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify({ personaId: 'coach', text: '这句不应触发合成' }),
    })
    expect(res.statusCode).toBe(403)
  })

  it('GET /tts 不再接受 query 文本,避免把弹幕内容放进 URL', async () => {
    app = await makeApp()
    const res = await app.inject({
      method: 'GET',
      url: '/tts?personaId=coach&text=' + encodeURIComponent('这句不应出现在 URL 合成链路'),
      headers: { origin: 'http://localhost:3420' },
    })
    expect(res.statusCode).toBe(405)
  })

  it('POST /tts 使用运行时 persona ttsVoice 覆盖默认音色', async () => {
    const calls: Array<{ text: string; voice: string }> = []
    app = await buildServer({
      dbPath: ':memory:',
      engine: fakeEngine,
      llm: new FakeLLM(() => 'x'),
      ttsSynthesizer: async (text: string, voice: string) => {
        calls.push({ text, voice })
        return 'https://tts.example/audio.wav'
      },
    } as any)
    const saveVoice = await app.inject({
      method: 'PUT',
      url: '/admin/personas/coach',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ ttsVoice: 'CustomCoachVoice' }),
    })
    expect(saveVoice.statusCode).toBe(200)

    const res = await app.inject({
      method: 'POST',
      url: '/tts',
      headers: { origin: 'https://evil.example', 'content-type': 'application/json' },
      payload: JSON.stringify({ personaId: 'coach', text: '音色测试' }),
    })
    expect(res.statusCode).toBe(403)

    const allowed = await app.inject({
      method: 'POST',
      url: '/tts',
      headers: { origin: 'http://localhost:3420', 'content-type': 'application/json' },
      payload: JSON.stringify({ personaId: 'coach', text: '音色测试' }),
    })
    expect(allowed.statusCode).toBe(200)
    expect(allowed.json<any>().url).toBe('https://tts.example/audio.wav')
    expect(calls).toEqual([{ text: '音色测试', voice: 'CustomCoachVoice' }])
  })
})
