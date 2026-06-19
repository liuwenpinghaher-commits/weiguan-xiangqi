import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { openDb } from './store/db.js'
import { GamesRepo } from './store/games-repo.js'
import { UciEngine, spawnTransport } from './engine/engine.js'
import { GameSession } from './session/game-session.js'
import { Position } from './rules/position.js'
import type { GameMode, Side } from './types.js'
import { AnalysisRepo } from './store/analysis-repo.js'
import { diagnoseGame } from './analysis/diagnose-game.js'
import { generateDrills } from './training/generate-drills.js'
import { compareWindows } from './report/compare.js'

export async function buildServer(opts: { dbPath: string; enginePath: string }) {
  const db = openDb(opts.dbPath)
  const repo = new GamesRepo(db)
  const engine = new UciEngine(spawnTransport(opts.enginePath))
  const session = new GameSession({
    repo,
    engine,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
  })

  const analysis = new AnalysisRepo(db)
  const diagDeps = { games: repo, analysis, engine, clock: () => new Date().toISOString(), depth: 12 }

  const app = Fastify({ logger: true })

  await app.register(fastifyWebsocket)

  // WebSocket 路由 /play
  // @fastify/websocket v10 handler 签名: (socket: WebSocket, req: FastifyRequest)
  // socket 直接是 ws.WebSocket 实例，使用 socket.on / socket.send
  app.get('/play', { websocket: true }, (socket, _req) => {
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
          socket.send(JSON.stringify({ type: 'started', gameId }))
        } else if (msg.type === 'move') {
          const result = await session.playHumanMove(msg.gameId as number, msg.move as string)
          socket.send(JSON.stringify({ type: 'update', ...result }))
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
    return { game, moves }
  })

  // 触发局后诊断(真跑引擎,可能数十秒)
  app.post('/games/:id/diagnose', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
    try {
      return await diagnoseGame(diagDeps, id)
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

  // 训练题(从某局人方失误生成)
  app.get('/games/:id/drills', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    const game = repo.getGame(id)
    if (!game) return reply.code(404).send({ error: 'not found' })
    const drills = generateDrills({
      gameId: id, humanSide: game.humanSide, startFen: game.startFen,
      moves: repo.getMoves(id), annotations: analysis.getAnnotations(id),
    })
    return { drills }
  })

  // 历史对比(已诊断局按时间对半:前半 vs 后半)
  app.get('/compare', async () => {
    const all = analysis.listGrowthMetrics()
    const mid = Math.floor(all.length / 2)
    return compareWindows(all.slice(0, mid), all.slice(mid))
  })

  return app
}
