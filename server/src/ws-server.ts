import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import { openDb } from './store/db.js'
import { GamesRepo } from './store/games-repo.js'
import { UciEngine, spawnTransport } from './engine/engine.js'
import { GameSession } from './session/game-session.js'
import { Position } from './rules/position.js'
import type { GameMode, Side } from './types.js'

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

  return app
}
