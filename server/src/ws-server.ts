import { existsSync } from 'node:fs'
import Fastify from 'fastify'
import fastifyWebsocket from '@fastify/websocket'
import fastifyCors from '@fastify/cors'
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
import { growthReport } from './report/llm-report.js'
import { prevFenForPly, worstHumanPly } from './report/sparring.js'
import { ChatEngine } from './chat/chat-engine.js'
import { DashscopeLLM } from './llm/dashscope.js'
import { FakeLLM } from './llm/fake.js'
import { synthesizeUrl, voiceForPersona } from './voice/dashscope-tts.js'
import { SurrealMemoryStore } from './memory/surreal-memory-store.js'
import { FakeMemoryStore } from './memory/fake-memory-store.js'
import { DashscopeEmbedding } from './llm/dashscope-embedding.js'
import { reflect } from './memory/reflection.js'
import { spectators } from './personas/personas.js'
import { describeMoveZh } from './rules/describe-move.js'
import { MessagesRepo } from './store/messages-repo.js'
import { serializeGame, validateImport } from './store/game-export.js'
import type { EngineLine } from './types.js'
import type { LLMProvider } from './llm/provider.js'

/** 引擎接口(与 GameSession.EngineLike 保持一致) */
export interface EngineLike {
  analyze(fen: string, opts: { multipv: number; movetime?: number; depth?: number }): Promise<EngineLine[]>
  /** 可选:释放引擎子进程。真实 UciEngine 实现此方法；假引擎可省略。 */
  close?(): void
}

export async function buildServer(opts: {
  dbPath: string
  enginePath?: string
  /** 若传入则直接使用,跳过 enginePath 构造(传 null 表示强制无引擎) */
  engine?: EngineLike | null
  /** 若传入则替换默认 LLM(FakeLLM/VolcanoLLM) */
  llm?: LLMProvider
}) {
  const db = openDb(opts.dbPath)
  const repo = new GamesRepo(db)
  const messages = new MessagesRepo(db)

  // 引擎:优先使用注入值;未注入则按 enginePath 构造
  let engine: EngineLike | null
  if ('engine' in opts) {
    // 显式传入(含 null):直接使用
    engine = opts.engine ?? null
  } else {
    // 未注入:按原始逻辑按路径构造
    engine = opts.enginePath && existsSync(opts.enginePath)
      ? new UciEngine(spawnTransport(opts.enginePath))
      : null
    if (!engine) {
      console.warn('象棋引擎未配置或路径不存在:对弈/诊断功能不可用,聊天与复盘仍可用')
    }
  }

  // 引擎 stub:同时满足 GameSession.EngineLike 与 DiagnoseDeps.EngineLike,
  // 调用时抛错(对弈/诊断的上层守卫会在更早处拦截,stub 仅作类型占位)
  const engineStub: {
    analyze(fen: string, opts?: { multipv: number; depth?: number; movetime?: number }): Promise<EngineLine[]>
  } = {
    analyze: async () => { throw new Error('引擎未配置') },
  }

  // --- 聊天基础设施 ---

  // LLM:优先使用注入值;未注入则按原始逻辑(DASHSCOPE env → DashscopeLLM / FakeLLM)
  let llm: LLMProvider
  if (opts.llm) {
    llm = opts.llm
  } else {
    const hasDashscope = !!process.env.DASHSCOPE_API_KEY
    llm = hasDashscope ? new DashscopeLLM() : new FakeLLM([], '')
    if (!hasDashscope) {
      console.warn('未配置 DASHSCOPE_API_KEY:观棋聊天功能不可用,对弈/诊断照常运行')
    }
  }

  // 记忆:优先 SurrealDB 语义记忆;连接/配置失败则降级为内存 store(聊天/反思照常,只是不持久、不语义)
  let mem: import('./memory/store.js').MemoryStore
  try {
    const embedding = new DashscopeEmbedding()
    const surreal = new SurrealMemoryStore({
      url: process.env.SURREAL_URL ?? 'ws://127.0.0.1:8000',
      namespace: process.env.SURREAL_NS ?? 'weiguan',
      database: process.env.SURREAL_DB ?? 'weiguan',
      username: process.env.SURREAL_USER ?? 'root',
      password: process.env.SURREAL_PASS ?? 'root',
      embedding,
      llm,
      now: () => Date.now(),
    })
    await surreal.connect()
    mem = surreal
  } catch (err) {
    console.warn('SurrealDB 记忆不可用,降级为内存记忆(不持久):', (err as Error).message)
    mem = new FakeMemoryStore(() => Date.now())
  }

  // 活跃 /play WebSocket 连接集合,用于广播聊天消息
  const sockets = new Set<any>()

  const chat = new ChatEngine({
    llm,
    mem,
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
      reflect({ store: mem, llm, personaId: p.id, gameId, now: () => Date.now(), playerSummary })
        .catch(() => { /* 反思失败静默忽略 */ })
    }
  }

  const session = new GameSession({
    repo,
    engine: engine ?? engineStub,
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
  // diagDeps.engine 仅在 engine 不为 null 时才会被实际调用(调用处均有守卫)
  const diagDeps = { games: repo, analysis, engine: engine ?? engineStub, clock: () => new Date().toISOString(), depth: 12 }

  // 局末自动诊断幂等 set(避免同一局重复触发引擎分析)
  const diagnosedGames = new Set<number>()

  const app = Fastify({ logger: true })

  // 跨域:前端(:3420)与后端(:3410)不同源,/tts、/games 等 HTTP fetch 需要 CORS。
  // 本地单人工具,反射任意来源即可(含 POST JSON 预检 OPTIONS)。
  await app.register(fastifyCors, { origin: true })

  // 优雅关闭:关闭 Fastify 时同步释放引擎子进程与 SQLite WAL
  app.addHook('onClose', async () => {
    try { engine?.close?.() } catch {}
    try { db.close() } catch {}
    try { if (mem instanceof SurrealMemoryStore) await mem.close() } catch {}
  })

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
          const humanSide = msg.humanSide as Side
          const gameId = session.newGame({
            mode: msg.mode as GameMode,
            humanSide,
            startFen: (msg.startFen as string | undefined) ?? 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
          })
          lastGameId = gameId
          socketGameId = gameId  // 记录该连接当前局 id,供 close 时触发中途反思
          socket.send(JSON.stringify({ type: 'started', gameId }))
          // 若玩家执黑且引擎可用，AI（红方）先手走一步
          if (humanSide === 'black' && engine) {
            try {
              const aiResult = await session.aiFirstMove(gameId)
              socket.send(JSON.stringify({ type: 'update', ...aiResult }))
            } catch (e) {
              socket.send(JSON.stringify({ type: 'error', message: `AI先手失败: ${(e as Error).message}` }))
            }
          }
        } else if (msg.type === 'move') {
          if (!engine) {
            socket.send(JSON.stringify({ type: 'error', message: '未配置象棋引擎,无法对弈(聊天/复盘仍可用)' }))
            return
          }
          const result = await session.playHumanMove(msg.gameId as number, msg.move as string)
          socket.send(JSON.stringify({ type: 'update', ...result }))
          // 局末:对每个旁观者触发反思(异步,失败不影响主流程)
          if (result.over) {
            const gameId = msg.gameId as number
            reflectGame(gameId).catch(() => { /* 反思失败静默忽略 */ })
            // 局末自动后台诊断(fire-and-forget,幂等;引擎未配置则跳过)
            if (engine && !diagnosedGames.has(gameId)) {
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
    if (!engine) return reply.code(503).send({ error: '引擎未配置,诊断功能不可用' })
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

  // 历史对比(已诊断局按时间对半:前半 vs 后半) + LLM 自然语言成长报告
  app.get('/compare', async () => {
    const all = analysis.listGrowthMetrics()
    const mid = Math.floor(all.length / 2)
    const cmp = compareWindows(all.slice(0, mid), all.slice(mid))
    const report = await growthReport(llm, cmp)
    return { ...cmp, report }
  })

  // 专项陪练:从该局人方丢分最大的那手走子前局面开始
  app.get('/games/:id/sparring', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id) || isNaN(id)) return reply.code(400).send({ error: 'invalid id' })
    const game = repo.getGame(id)
    if (!game) return reply.code(404).send({ error: 'not found' })

    const anns = analysis.getAnnotations(id)
    const ply = worstHumanPly(anns, game.humanSide)
    if (ply === null) {
      // 无诊断数据或无失误
      return { startFen: null, humanSide: game.humanSide, ply: null }
    }
    const moves = repo.getMoves(id)
    const startFen = prevFenForPly(game, moves, ply)
    return { startFen, humanSide: game.humanSide, ply }
  })

  // ── 棋谱导出/导入 ──────────────────────────────────────────

  // 单局导出：GET /games/:id/export
  // 返回 JSON，Content-Disposition 触发浏览器下载
  app.get('/games/:id/export', async (req, reply) => {
    const id = Number((req.params as { id: string }).id)
    if (!Number.isInteger(id) || isNaN(id)) return reply.code(400).send({ error: 'invalid id' })
    const game = repo.getGame(id)
    if (!game) return reply.code(404).send({ error: 'not found' })
    const moves = repo.getMoves(id)
    const exported = serializeGame(game, moves)
    reply.header('Content-Disposition', `attachment; filename="game-${id}.json"`)
    reply.header('Content-Type', 'application/json')
    return exported
  })

  // 全库导出：GET /export
  // 遍历所有对局并序列化，返回 { games: GameExport[] }
  app.get('/export', async (_req, reply) => {
    const allGames = repo.listGames()
    const games = allGames.map(game => {
      const moves = repo.getMoves(game.id)
      return serializeGame(game, moves)
    })
    reply.header('Content-Disposition', 'attachment; filename="xiangqi-export.json"')
    reply.header('Content-Type', 'application/json')
    return { games }
  })

  // 棋谱导入：POST /games/import
  // body: { startFen?, moves: string[], mode?, result? }
  // 校验失败 → 400；成功 → { gameId }
  app.post('/games/import', async (req, reply) => {
    let validated: ReturnType<typeof validateImport>
    try {
      const body = req.body as {
        startFen?: string; moves?: unknown; mode?: string; result?: string
      }
      if (!Array.isArray(body?.moves)) {
        return reply.code(400).send({ error: 'moves 必须为字符串数组' })
      }
      validated = validateImport({
        startFen: body.startFen,
        moves: body.moves as string[],
        mode: body.mode,
        result: body.result,
      })
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }

    const { startFen, moves, mode, result } = validated
    const now = new Date().toISOString()

    // createGame：humanSide 无法从导出数据还原（本系统简化：默认 red）
    const gameId = repo.createGame({ mode: mode as GameMode, humanSide: 'red', startFen, startedAt: now })

    // 逐手重放写入 moves 表；side 从 startFen 起算交替
    let pos = Position.fromFen(startFen)
    for (const move of moves) {
      const side = pos.sideToMove()
      const nextPos = pos.applyMove(move)
      repo.addMove({
        gameId,
        side,
        move,
        fenAfter: nextPos.fen(),
        scoreCp: null,
        byAi: false,
      })
      pos = nextPos
    }

    // 如果有结果，补写 finishGame
    if (result !== null) {
      repo.finishGame(gameId, result, now)
    }

    return { gameId }
  })

  // ── 云端 TTS 合成 ─────────────────────────────────────────────────────────────
  // GET /tts?personaId=xxx&text=xxx
  // 无 DASHSCOPE_API_KEY → 503(前端回退浏览器 TTS)
  // 成功 → JSON { url } (OSS 公网音频 URL,24h 有效);出错 → 500
  app.get('/tts', async (req, reply) => {
    if (!process.env.DASHSCOPE_API_KEY) {
      return reply.code(503).send({ error: '未配置 DASHSCOPE_API_KEY,TTS 不可用' })
    }
    const query = req.query as { personaId?: string; text?: string }
    const personaId = String(query.personaId ?? '')
    const rawText = String(query.text ?? '').trim()
    if (!rawText) {
      return reply.code(400).send({ error: 'text 参数不能为空' })
    }
    const text = rawText.slice(0, 200)
    const voice = voiceForPersona(personaId)
    const endpoint = process.env.DASHSCOPE_TTS_ENDPOINT ?? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    const model = process.env.DASHSCOPE_TTS_MODEL ?? 'qwen3-tts-flash'
    try {
      const url = await synthesizeUrl(text, voice, {
        endpoint,
        apiKey: process.env.DASHSCOPE_API_KEY,
        model,
      })
      reply.header('Content-Type', 'application/json')
      return reply.send({ url })
    } catch (e) {
      return reply.code(500).send({ error: (e as Error).message })
    }
  })

  return app
}
