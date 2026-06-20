import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { openDb } from './store/db.js'
import { GamesRepo } from './store/games-repo.js'
import { UciEngine, spawnTransport } from './engine/engine.js'
import { GameSession } from './session/game-session.js'
import { Position } from './rules/position.js'
import type { GameMode, Side } from './types.js'
import { AnalysisRepo } from './store/analysis-repo.js'
import { TrainingRepo } from './store/training-repo.js'
import { diagnoseGame } from './analysis/diagnose-game.js'
import { generateDrills } from './training/generate-drills.js'
import { compareWindows } from './report/compare.js'
import { ChatEngine } from './chat/chat-engine.js'
import { VolcanoLLM } from './llm/volcano.js'
import { PersonaMemoryRepo } from './memory/persona-memory-repo.js'
import { reflect } from './memory/reflection.js'
import { spectators } from './personas/personas.js'
import { describeMoveZh } from './rules/describe-move.js'
import { MessagesRepo } from './store/messages-repo.js'

export async function buildServer(opts: { dbPath: string; enginePath: string }) {
  const db = openDb(opts.dbPath)
  const repo = new GamesRepo(db)
  const messages = new MessagesRepo(db)
  const engine = new UciEngine(spawnTransport(opts.enginePath))

  // --- 聊天基础设施 ---
  const pmem = new PersonaMemoryRepo(db)
  const llm = new VolcanoLLM()

  // 活跃 /play WebSocket 连接集合,用于广播聊天消息
  const sockets = new Set<any>()

  const chat = new ChatEngine({
    llm,
    mem: pmem,
    now: () => Date.now(),
    emit: (line) => {
      const msg = JSON.stringify({ type: 'chat', ...line })
      for (const s of sockets) {
        try { s.send(msg) } catch {}
      }
      // 落库:广播完成后持久化,失败不影响推送
      try {
        messages.addMessage({
          gameId: line.gameId,
          personaId: line.personaId,
          role: 'persona',
          text: line.text,
          addressee: line.addressee,
          ts: line.ts,
        })
      } catch {
        // 落库失败静默忽略,不影响 WS 推送
      }
    },
    rng: Math.random,
    tempo: { minSilenceMs: 4000, maxPerMin: 12 },
  })

  // 记最近一局 gameId,供冷场定时器使用
  let lastGameId: number | null = null

  // 局末反思幂等:已完成反思的局不重复触发
  const reflectedGames = new Set<number>()

  // ---- 抽取的反思 helper:对某局的所有旁观者触发 reflect ----
  async function reflectGame(gameId: number): Promise<void> {
    if (reflectedGames.has(gameId)) return
    reflectedGames.add(gameId)

    // 拼玩家本局真实走法概述
    let playerSummary = ''
    try {
      const game = repo.getGame(gameId)
      const moves = repo.getMoves(gameId)
      if (game) {
        const humanMoves = moves.filter(m => !m.byAi).slice(0, 12)
        const parts: string[] = []
        for (const m of humanMoves) {
          const prevFen = m.ply <= 1
            ? game.startFen
            : (moves.find(x => x.ply === m.ply - 1)?.fenAfter ?? game.startFen)
          try {
            parts.push(describeMoveZh(prevFen, m.move))
          } catch {
            // 单步描述失败跳过
          }
        }
        playerSummary = parts.join(';')
      }
    } catch {
      // 走法拼接失败,playerSummary 保持空字符串,reflect 会提前返回
    }

    for (const p of spectators()) {
      reflect({ repo: pmem, llm, personaId: p.id, gameId, now: () => Date.now(), playerSummary })
        .catch(() => { /* 反思失败静默忽略 */ })
    }
  }

  const session = new GameSession({
    repo,
    engine,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
    onStimulus: (s) => { void chat.onStimulus(s) },
  })

  // 冷场定时器:每 20 秒以 35% 概率投一个高张力 idle 刺激,让茶馆偶尔有人闲扯,又不刷屏
  const idleInterval = setInterval(() => {
    if (lastGameId === null) return
    if (Math.random() < 0.35) {
      void chat.onStimulus({ kind: 'idle', gameId: lastGameId, scoreCp: null, tension: 0.55 })
    }
  }, 20_000)
  idleInterval.unref?.()

  const analysis = new AnalysisRepo(db)
  const training = new TrainingRepo(db)
  const diagDeps = { games: repo, analysis, engine, clock: () => new Date().toISOString(), depth: 12 }

  // 局末自动诊断幂等 set(避免同一局重复触发引擎分析)
  const diagnosedGames = new Set<number>()

  const app = Fastify({ logger: true })

  await app.register(fastifyWebsocket)

  // WebSocket 路由 /play
  // @fastify/websocket v10 handler 签名: (socket: WebSocket, req: FastifyRequest)
  // socket 直接是 ws.WebSocket 实例，使用 socket.on / socket.send
  app.get('/play', { websocket: true }, (socket, _req) => {
    sockets.add(socket)
    // 记录该连接最近的 gameId,供 close 时触发中途反思
    let socketGameId: number | null = null

    socket.on('close', () => {
      sockets.delete(socket)
      // 中途关页面:若该连接有进行中对局且走法足够多,触发反思沉淀记忆
      if (socketGameId !== null) {
        const gid = socketGameId
        try {
          const moves = repo.getMoves(gid)
          const humanMoves = moves.filter(m => !m.byAi)
          // ≥6 手人类着法才有足够内容反思,避免空局浪费 token
          if (humanMoves.length >= 6) {
            reflectGame(gid).catch(() => { /* 中途关页面反思失败静默忽略 */ })
          }
        } catch {
          // getMoves 失败静默忽略
        }
      }
    })

    socket.on('message', async (raw) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(raw.toString())
      } catch {
        socket.send(JSON.stringify({ type: 'error', message: 'invalid JSON' }))
        return
      }

      const msg = parsed as Record<string, unknown>

      try {
        if (msg.type === 'new') {
          const gameId = session.newGame({
            mode: msg.mode as GameMode,
            humanSide: msg.humanSide as Side,
            startFen: (msg.startFen as string | undefined) ?? 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
          })
          lastGameId = gameId
          socketGameId = gameId  // 记录该连接当前局 id,供 close 时触发中途反思
          socket.send(JSON.stringify({ type: 'started', gameId }))
        } else if (msg.type === 'move') {
          const result = await session.playHumanMove(msg.gameId as number, msg.move as string)
          socket.send(JSON.stringify({ type: 'update', ...result }))
          // 局末:对每个旁观者触发反思(异步,失败不影响主流程)
          if (result.over) {
            const gameId = msg.gameId as number
            reflectGame(gameId).catch(() => { /* 反思失败静默忽略 */ })
            // 局末自动后台诊断(fire-and-forget,幂等)
            if (!diagnosedGames.has(gameId)) {
              diagnosedGames.add(gameId)
              void diagnoseGame(diagDeps, gameId).catch(() => { /* 诊断失败静默忽略,不影响对局 */ })
            }
          }
        } else if (msg.type === 'say') {
          // 玩家发言 → human_said 刺激,高张力必有人接
          const gid = msg.gameId
          if (typeof gid !== 'number') return
          // 玩家发言持久化
          try {
            messages.addMessage({
              gameId: gid,
              personaId: 'human',
              role: 'human',
              text: String(msg.text ?? ''),
              addressee: 'all',
              ts: new Date().toISOString(),
            })
          } catch {
            // 落库失败静默忽略
          }
          void chat.onStimulus({
            kind: 'human_said',
            gameId: gid,
            scoreCp: null,
            humanText: String(msg.text ?? ''),
            tension: 0.9,
          })
        } else {
          socket.send(JSON.stringify({ type: 'error', message: `unknown message type: ${msg.type}` }))
        }
      } catch (e) {
        const err = e as Error
        socket.send(JSON.stringify({ type: 'error', message: err.message }))
      }
    })
  })

  // HTTP 只读路由 /games/:id（供复盘页）
  app.get('/games/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const numId = parseInt(id, 10)
    if (isNaN(numId)) {
      return reply.code(400).send({ error: 'invalid id' })
    }
    const game = repo.getGame(numId)
    if (!game) {
      return reply.code(404).send({ error: 'not found' })
    }
    const moves = repo.getMoves(numId)
    const msgs = messages.getMessages(numId)
    return { game, moves, messages: msgs }
  })

  // 触发局后诊断(真跑引擎,可能数十秒)
  app.post('/games/:id/diagnose', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
    try {
      const result = await diagnoseGame(diagDeps, id)
      diagnosedGames.add(id)  // 手动诊断后标记,避免局末再重复
      return result
    } catch (e) {
      return reply.code(404).send({ error: (e as Error).message })
    }
  })

  // 单局诊断结果(评分曲线 + 每手标注)
  app.get('/games/:id/diagnosis', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const game = repo.getGame(id)
    if (!game) return reply.code(404).send({ error: 'not found' })
    return { game, moves: repo.getMoves(id), annotations: analysis.getAnnotations(id) }
  })

  // 成长曲线(逐局指标时间序列)
  app.get('/growth', async () => ({ metrics: analysis.listGrowthMetrics() }))

  // 弱点画像(按 phase×theme 聚合)
  app.get('/weakness', async (req) => {
    const side = ((req.query as { side?: string }).side ?? 'red') as 'red' | 'black'
    return { side, profile: analysis.weaknessProfile(side) }
  })

  // 训练题(从某局人方失误生成),附带该局训练进度 stats
  app.get('/games/:id/drills', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const game = repo.getGame(id)
    if (!game) return reply.code(404).send({ error: 'not found' })
    const drills = generateDrills({
      gameId: id, humanSide: game.humanSide, startFen: game.startFen,
      moves: repo.getMoves(id), annotations: analysis.getAnnotations(id),
    })
    const stats = training.drillStats(id)
    return { drills, stats }
  })

  // 提交训练作答(后端根据 bestMove 判定 correct,更可信)
  app.post('/games/:id/drills/attempt', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id) || isNaN(id)) return reply.code(400).send({ error: 'invalid id' })
    const game = repo.getGame(id)
    if (!game) return reply.code(404).send({ error: 'game not found' })

    const body = req.body as { ply?: unknown; chosenMove?: unknown }
    const ply = Number(body?.ply)
    const chosenMove = String(body?.chosenMove ?? '')
    if (!Number.isInteger(ply) || ply <= 0) return reply.code(400).send({ error: 'invalid ply' })
    if (!chosenMove) return reply.code(400).send({ error: 'chosenMove required' })

    // 后端判定:从该局的 annotations 里找对应 ply 的 bestMove
    const annotations = analysis.getAnnotations(id)
    const ann = annotations.find((a) => a.ply === ply)
    const correct = ann != null ? chosenMove === ann.bestMove : false

    training.addDrillAttempt({
      gameId: id,
      ply,
      chosenMove,
      correct,
      createdAt: new Date().toISOString(),
    })

    const stats = training.drillStats(id)
    return { correct, stats }
  })

  // 全局训练进度
  app.get('/training/stats', async () => {
    return training.drillStatsAll()
  })

  // 历史对比(已诊断局按时间对半:前半 vs 后半)
  app.get('/compare', async () => {
    const all = analysis.listGrowthMetrics()
    const mid = Math.floor(all.length / 2)
    return compareWindows(all.slice(0, mid), all.slice(mid))
  })

  return app
}
