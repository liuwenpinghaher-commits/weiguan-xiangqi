import { mkdirSync, existsSync } from 'node:fs'
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
import { idleShouldFire } from './chat/idle-policy.js'
import { RuntimeConfig } from './config/runtime-config.js'
import { SettingsRepo } from './store/settings-repo.js'
import { MutableLLM, buildInnerLlm } from './llm/mutable-llm.js'
import { registerAdminRoutes } from './admin/admin-routes.js'
import { join } from 'node:path'
import fastifyStatic from '@fastify/static'
import { synthesizeUrl, voiceForPersona } from './voice/dashscope-tts.js'
import { DashscopeAsr } from './voice/dashscope-asr.js'
import { SqliteMemoryStore } from './memory/sqlite-memory-store.js'
import { DashscopeEmbedding } from './llm/dashscope-embedding.js'
import { reflect } from './memory/reflection.js'
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
  /** 若传入则替换默认 LLM(测试注入 FakeLLM) */
  llm?: LLMProvider
  /** 若传入则直接使用,跳过 DASHSCOPE key 检查与 DashscopeAsr 构造(测试注入 FakeAsr) */
  asr?: import('./voice/asr.js').AsrProvider
}) {
  const db = openDb(opts.dbPath)
  const repo = new GamesRepo(db)
  const messages = new MessagesRepo(db)

  // 配置:代码默认 ⊕ DB 覆盖 的唯一读取入口(控制台改库即时生效)
  const cfg = new RuntimeConfig(new SettingsRepo(db), () => new Date().toISOString())

  // 引擎:优先使用注入值;未注入则按 enginePath 构造
  let engine: EngineLike | null
  if ('engine' in opts) {
    // 显式传入(含 null):直接使用
    engine = opts.engine ?? null
  } else {
    // 未注入:env PIKAFISH_PATH 优先,回退控制台配置的 engine.pikafishPath
    // (原来 DB 值是 100% 死配置——写了但 spawn 永不读;现在重启后生效,控制台提示才成立)
    const enginePath = opts.enginePath ?? cfg.getEngineParams().pikafishPath ?? undefined
    engine = enginePath && existsSync(enginePath)
      ? new UciEngine(spawnTransport(enginePath))
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
    const mutable = new MutableLLM(buildInnerLlm(cfg.getLlm()))
    cfg.onLlmChange = () => mutable.replace(buildInnerLlm(cfg.getLlm()))
    llm = mutable
    if (!cfg.getLlm().apiKey) console.warn('未配置 DASHSCOPE_API_KEY:观棋聊天功能不可用,对弈/诊断照常运行')
  }

  // 记忆:SQLite 语义记忆(向量存 JSON,检索时 JS 算余弦)。始终持久,不再依赖独立 SurrealDB 进程,
  // 也不再有"连接失败→内存降级"。嵌入凭据跟随控制台 llm 段热更(初始+热更都用 cfg.getLlm() ?? env)。
  // 嵌入构造容错:无凭据时不抛垮 boot——inner=null,embed 失败→SqliteMemoryStore 照存无向量(退 recency),
  // 记忆仍持久;控制台配上 key 后热更即恢复语义检索。
  const buildEmbedding = (l: { apiKey: string | null; baseURL: string | null }): DashscopeEmbedding | null => {
    // 嵌入端点可独立于 chat:EMBEDDING_BASE_URL/EMBEDDING_API_KEY 优先,未设则回退 llm 段。
    // 用途:chat 走云(如 DeepSeek,无嵌入 API),嵌入固定走本地 Ollama bge-m3——两端解耦。
    const base = process.env.EMBEDDING_BASE_URL ?? l.baseURL
    const key = process.env.EMBEDDING_API_KEY ?? l.apiKey
    try { return new DashscopeEmbedding(undefined, undefined, undefined, key ?? undefined, base ?? undefined) }
    catch { return null }
  }
  let innerEmbedding = buildEmbedding(cfg.getLlm())
  const prevOnLlmChange = cfg.onLlmChange
  cfg.onLlmChange = () => {
    prevOnLlmChange?.()
    const next = buildEmbedding(cfg.getLlm())
    if (next) innerEmbedding = next  // 缺凭据时保留旧实例
  }
  const embedding = {
    embed: (texts: string[]) => innerEmbedding ? innerEmbedding.embed(texts) : Promise.reject(new Error('嵌入未配置')),
    get dimension() { return innerEmbedding?.dimension ?? 1024 },
  }
  const mem: import('./memory/store.js').MemoryStore = new SqliteMemoryStore({ db, embedding, llm, now: () => Date.now() })

  // 活跃 /play WebSocket 连接集合,用于广播聊天消息
  const sockets = new Set<any>()

  const chat = new ChatEngine({
    llm,
    mem,
    cfg,
    now: () => Date.now(),
    emit: (line) => {
      lastChatAt = Date.now()
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
  })

  // 记最近一局 gameId,供冷场定时器使用
  let lastGameId: number | null = null

  // 记最近一条弹幕(角色或人类)时间戳,供沉默驱动的 idle 判定使用
  let lastChatAt = Date.now()

  // 局末反思幂等:仅"成功完成"反思的局进入此 Set,不再重复触发。
  const reflectedGames = new Set<number>()
  // 防重入:正在反思中的局(避免并发重复触发);finally 后移除,成功才进 reflectedGames。
  const reflectingGames = new Set<number>()

  // ---- 抽取的反思 helper:对某局的所有旁观者触发 reflect ----
  // 仅在 reflect 全部成功后才标记 reflectedGames;任一失败则不标记 → 下次有机会重试,
  // 避免一次失败(LLM/写库异常)导致该局记忆永久不沉淀。
  async function reflectGame(gameId: number): Promise<void> {
    if (reflectedGames.has(gameId) || reflectingGames.has(gameId)) return
    reflectingGames.add(gameId)
    try {
      await doReflectGame(gameId)
      reflectedGames.add(gameId)
    } catch (err) {
      console.warn('[reflect] 局', gameId, '反思失败,未标记完成(下次可重试):', (err as Error).message)
    } finally {
      reflectingGames.delete(gameId)
    }
  }

  async function doReflectGame(gameId: number): Promise<void> {
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

    // 等待所有旁观者反思完成;任一失败则整体抛出 → reflectGame 不标记 reflectedGames(下次重试)。
    // 名册走运行时配置(尊重控制台 enabled 开关):禁用角色不参与反思,
    // 修"禁用任一角色 → getPersona 抛错 → 反思整体失败无限重跑"
    await Promise.all(cfg.personas().filter(p => !p.isPlayer).map(p =>
      reflect({
        store: mem, llm, personaId: p.id, gameId, now: () => Date.now(), playerSummary,
        getPersona: (id) => cfg.getPersona(id),
      })
    ))
  }

  const session = new GameSession({
    repo,
    cfg,
    engine: engine ?? engineStub,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
    onStimulus: (s) => { if (!pausedGames.has(s.gameId) && !spectatorsOffGames.has(s.gameId)) void chat.onStimulus(s) },
  })

  // 冷场补话:沉默驱动(非节拍式)。定时器每 idleIntervalMs 检查一次,仅当有进行中对局、
  // 未暂停、距上一条弹幕沉默 ≥IDLE_SILENCE_MS、且掷骰命中 idleProb 时,才投一个贴局面的 idle 刺激。
  // 用自重排的 setTimeout 使 idleIntervalMs/idleProb 配置变更在下个周期即时生效。
  let idleTimer: ReturnType<typeof setTimeout> | null = null
  const IDLE_SILENCE_MS = 30000
  const scheduleIdle = () => {
    const c = cfg.getChat()
    idleTimer = setTimeout(() => {
      if (idleShouldFire({
        hasGame: lastGameId !== null,
        paused: lastGameId !== null && (pausedGames.has(lastGameId) || spectatorsOffGames.has(lastGameId)),
        silentMs: Date.now() - lastChatAt,
        silenceThresholdMs: IDLE_SILENCE_MS,
        roll: Math.random(),
        prob: cfg.getChat().idleProb,
      })) {
        void chat.onStimulus({ kind: 'idle', gameId: lastGameId!, scoreCp: null, tension: cfg.getChat().idleTension })
      }
      scheduleIdle()
    }, c.idleIntervalMs)
    idleTimer.unref?.()
  }
  scheduleIdle()

  // 时钟超时清扫器:每 2s 检查在途走钟,归零 → 判负 + 广播 + 走终局收尾链
  // (flag-fall 不能只靠"下一手走子时检查"——超时方可能永远不走那手棋)
  const clockSweeper = setInterval(() => {
    for (const gid of session.activeClockGameIds()) {
      if (pausedGames.has(gid)) continue
      const timedOut = session.checkTimeout(gid)
      if (!timedOut) continue
      const frame = JSON.stringify({ type: 'update', aiMove: null, ...timedOut, clockState: null })
      for (const s of sockets) {
        try { s.send(frame) } catch { /* 单连接发送失败忽略 */ }
      }
      cleanupFinishedGame(gid)
      reflectThenForget(gid)
    }
  }, 2000)
  clockSweeper.unref?.()

  const analysis = new AnalysisRepo(db)
  const training = new TrainingRepo(db)
  // diagDeps.engine 仅在 engine 不为 null 时才会被实际调用(调用处均有守卫)
  // depth 用 getter 每次诊断时读 cfg,保证控制台改 diagnose.depth 即时生效(不需重启)
  const diagDeps = {
    games: repo, analysis, engine: engine ?? engineStub, clock: () => new Date().toISOString(),
    get depth() { return cfg.getDiagnose().depth },
  }

  // 局末自动诊断幂等 set(避免同一局重复触发引擎分析)
  const diagnosedGames = new Set<number>()

  // 暂停中的对局:整局总开关。暂停期间停冷场定时器、跳过 move/say/idle 刺激,不生成不广播。
  const pausedGames = new Set<number>()

  // 关闭观众席的对局:用户可开/关旁观者(弹幕+语音)。关闭期间不生成任何 chat 刺激,
  // 不浪费 LLM/TTS,也不广播弹幕(与 pause 同构,但 pause 连棋也停、此处只停观众席)。
  const spectatorsOffGames = new Set<number>()

  // 对局结束时集中清理按 gameId 累积的容器,防渐进内存泄漏 + gameId 复用误判。
  // pausedGames 与 chat 上下文可立即清(终局后不会再有该局刺激);
  // reflectedGames/diagnosedGames 是异步反思/诊断的幂等闸,须等其 fire-and-forget 落定后再清,
  // 否则会在反思/诊断在途时丢掉去重标记导致重复触发。
  function cleanupFinishedGame(gameId: number): void {
    pausedGames.delete(gameId)
    spectatorsOffGames.delete(gameId)
    chat.forgetGame(gameId)
  }
  function forgetGuards(gameId: number): void {
    reflectedGames.delete(gameId)
    diagnosedGames.delete(gameId)
  }
  // 终局(超时/认负/和棋)路径的反思:反思落定后清幂等闸,避免 reflectedGames 单调泄漏(修 R-10)。
  // move-over 路径另有 reflect+diagnose 合并清理,不走这里。
  function reflectThenForget(gameId: number): void {
    void reflectGame(gameId).catch(() => { /* 反思失败静默 */ }).finally(() => forgetGuards(gameId))
  }

  const app = Fastify({ logger: true })

  // 统一错误体:框架级 413/415 给干净中文(默认体会透出 FST_ERR_* 内部码),
  // 未被路由捕获的 5xx 一律不透传内部信息(与 /tts、/asr 的脱敏口径一致)。
  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; message?: string }
    const sc = typeof e.statusCode === 'number' && e.statusCode >= 400 ? e.statusCode : 500
    const msg = sc === 413 ? '请求体过大'
      : sc === 415 ? '内容类型不支持'
      : sc >= 500 ? '服务器内部错误'
      : (e.message ?? '请求错误')
    if (sc >= 500) req.log.error(err, '未捕获错误')
    reply.code(sc).send({ error: msg })
  })

  // 跨域:仅允许本地前端(:3420)读取响应。原先 origin:true 反射任意来源——意味着你浏览器里
  // 打开的任何网页都能跨域 fetch 本服务,读到 /admin/.../reveal 的明文 key 或 PUT 篡改配置。
  // 收紧到固定前端来源即可堵住(非浏览器客户端如 curl 不受 CORS 约束,正常工作)。
  await app.register(fastifyCors, { origin: ['http://localhost:3420', 'http://127.0.0.1:3420'] })

  // 静态文件服务:暴露生成的 TTS WAV 文件给前端播放
  const staticDir = join(import.meta.dirname, '..', 'static')
  if (!existsSync(staticDir)) mkdirSync(staticDir, { recursive: true })
  await app.register(fastifyStatic, {
    root: staticDir,
    prefix: '/static/',
  })

  // 优雅关闭:关闭 Fastify 时同步释放引擎子进程与 SQLite WAL
  app.addHook('onClose', async () => {
    if (idleTimer) clearTimeout(idleTimer)
    clearInterval(clockSweeper)
    try { engine?.close?.() } catch {}
    try { db.close() } catch {}
  })

  await app.register(fastifyWebsocket)

  // 二进制 body parser:让 POST /asr 的 application/octet-stream 请求体成为 Buffer
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_req, body, done) => done(null, body))

  // 控制台 admin 路由(配置/角色/记忆/对局管理)
  registerAdminRoutes(app, { cfg, mem, games: repo, messages })

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
          // 畸形输入健壮性(修 R-11):humanSide/mode 缺省或非法会让后续 humanSides.get 落空 →
          // playHumanMove "not your turn" 恒真死局。开局前显式校验,拒绝畸形请求。
          if (msg.humanSide !== 'red' && msg.humanSide !== 'black') {
            socket.send(JSON.stringify({ type: 'error', message: '非法 humanSide(只允许 red/black)' })); return
          }
          if (msg.mode !== 'coach' && msg.mode !== 'humanlike') {
            socket.send(JSON.stringify({ type: 'error', message: '非法 mode(只允许 coach/humanlike)' })); return
          }
          const humanSide = msg.humanSide as Side
          const startFen = (msg.startFen as string | undefined) ?? 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'
          // 执黑需要 AI 先手,无引擎时是死局:开局前明确拒绝而非留下不可玩的残局
          if (humanSide === 'black' && !engine) {
            socket.send(JSON.stringify({ type: 'error', message: '未配置象棋引擎,无法执黑对弈(执红可落子但无 AI 应手)' }))
            return
          }
          const gameId = session.newGame({ mode: msg.mode as GameMode, humanSide, startFen })
          lastGameId = gameId
          socketGameId = gameId  // 记录该连接当前局 id,供 close 时触发中途反思
          // 开局即带的观众席开关(默认开;前端可在 new 里传 spectators:false 表示开局就关)
          if (msg.spectators === false) spectatorsOffGames.add(gameId)
          socket.send(JSON.stringify({ type: 'started', gameId }))
          // AI 先手条件:引擎可用,且当前局面轮到的不是人类(标准开局执黑=红方 AI 先走;
          // 专项陪练的中局 FEN 若轮到人走,不触发——修"执黑陪练必弹伪错误")
          if (engine && session.getFen(gameId) && msg.humanSide !== undefined) {
            const sideToMove = session.getFen(gameId).split(' ')[1] === 'b' ? 'black' : 'red'
            if (sideToMove !== humanSide) {
              try {
                const aiResult = await session.aiFirstMove(gameId)
                const clockState = session.getClockState(gameId)
                socket.send(JSON.stringify({ type: 'update', ...aiResult, clockState }))
              } catch (e) {
                socket.send(JSON.stringify({ type: 'error', message: `AI先手失败: ${(e as Error).message}` }))
              }
            }
          }
        } else if (msg.type === 'move') {
          const gid = msg.gameId
          if (typeof gid !== 'number') { socket.send(JSON.stringify({ type: 'error', message: '非法 gameId' })); return }
          if (typeof msg.move !== 'string') { socket.send(JSON.stringify({ type: 'error', message: '非法 move' })); return }
          if (pausedGames.has(gid)) return
          if (!engine) {
            socket.send(JSON.stringify({ type: 'error', message: '未配置象棋引擎,无法对弈(聊天/复盘仍可用)' }))
            return
          }
          const result = await session.playHumanMove(gid, msg.move)
          const clockState = session.getClockState(gid)
          socket.send(JSON.stringify({ type: 'update', ...result, clockState }))
          // 局末:对每个旁观者触发反思(异步,失败不影响主流程)
          if (result.over) {
            const gameId = gid
            // 立即清理暂停态与聊天上下文(终局后不再有该局刺激)
            cleanupFinishedGame(gameId)
            const reflectP = reflectGame(gameId).catch(() => { /* 反思失败静默忽略 */ })
            // 局末自动后台诊断(fire-and-forget,幂等;引擎未配置则跳过)
            let diagP: Promise<unknown> = Promise.resolve()
            if (engine && !diagnosedGames.has(gameId)) {
              diagnosedGames.add(gameId)
              diagP = diagnoseGame(diagDeps, gameId).catch(() => { /* 诊断失败静默忽略,不影响对局 */ })
            }
            // 反思+诊断都落定后,再清掉幂等闸,避免在途时丢去重标记
            void Promise.allSettled([reflectP, diagP]).then(() => forgetGuards(gameId))
          }
        } else if (msg.type === 'say') {
          // 玩家发言 → human_said 刺激,高张力必有人接
          const gid = msg.gameId
          if (typeof gid !== 'number') return
          if (pausedGames.has(gid)) return // 整局暂停:前端已禁输入,这里兜底
          const text = String(msg.text ?? '').slice(0, 500) // 限长,防超大字符串写库
          if (text.trim() === '') return // 空白发言:不落库、不广播、不触发刺激
          const ts = new Date().toISOString()
          // 玩家发言持久化
          try {
            messages.addMessage({ gameId: gid, personaId: 'human', role: 'human', text, addressee: 'all', ts })
          } catch {
            // 落库失败静默忽略
          }
          // 回显给所有客户端:角色消息走 chat.emit→sockets,人类消息此前漏了广播,
          // 导致用户自己说的话不显示在聊天框。这里补上,与角色消息同一 chat 帧格式。
          const echo = JSON.stringify({ type: 'chat', gameId: gid, personaId: 'human', text, addressee: 'all', ts })
          for (const s of sockets) {
            try { s.send(echo) } catch { /* 单连接发送失败忽略 */ }
          }
          lastChatAt = Date.now()
          // 观众席关闭 = 观棋者闭嘴(不产生 AI 回应刺激),但玩家自己的话照常回显+落库
          const cfg2 = cfg.getChat()
          if (!spectatorsOffGames.has(gid)) {
            void chat.onStimulus({ kind: 'human_said', gameId: gid, scoreCp: null, humanText: text, tension: cfg2.humanSaidTension })
          }
        } else if (msg.type === 'pause') {
          const gid = msg.gameId
          if (typeof gid === 'number') {
            pausedGames.add(gid)
            session.pauseClock(gid)  // 暂停真停钟:不再把暂停的墙钟时间扣给玩家
          }
        } else if (msg.type === 'resume') {
          const gid = msg.gameId
          if (typeof gid === 'number') {
            pausedGames.delete(gid)
            session.resumeClock(gid)
          }
        } else if (msg.type === 'spectators') {
          // 开/关观众席:关闭则停生成弹幕/语音(服务端不再产生 chat 刺激),开启则恢复
          const gid = msg.gameId
          if (typeof gid === 'number') {
            if (msg.enabled === false) spectatorsOffGames.add(gid)
            else spectatorsOffGames.delete(gid)
          }
        } else if (msg.type === 'resign') {
          const gid = msg.gameId
          if (typeof gid !== 'number') { socket.send(JSON.stringify({ type: 'error', message: '非法 gameId' })); return }
          const clockState = session.getClockState(gid) // 在 resign 清内存态前取时钟快照
          const { result, fen } = session.resign(gid)
          socket.send(JSON.stringify({ type: 'update', aiMove: null, fen, over: true, result, clockState }))
          cleanupFinishedGame(gid)
          reflectThenForget(gid)
        } else if (msg.type === 'draw_offer') {
          const gid = msg.gameId
          if (typeof gid !== 'number') { socket.send(JSON.stringify({ type: 'error', message: '非法 gameId' })); return }
          const clockState = session.getClockState(gid) // 在 offerDraw 可能清内存态前取时钟快照
          const { accepted, fen } = session.offerDraw(gid)
          socket.send(JSON.stringify({ type: 'draw_response', gameId: gid, accepted }))
          if (accepted) {
            socket.send(JSON.stringify({ type: 'update', aiMove: null, fen, over: true, result: 'draw', clockState }))
            cleanupFinishedGame(gid)
            reflectThenForget(gid)
          }
        } else if (msg.type === 'undo') {
          const gid = msg.gameId
          if (typeof gid !== 'number') { socket.send(JSON.stringify({ type: 'error', message: '非法 gameId' })); return }
          const result = session.undoLastMoves(gid)
          if (result.success) {
            const clockState = session.getClockState(gid)
            socket.send(JSON.stringify({ type: 'undo_result', gameId: gid, success: true, fen: result.fen, clockState, undoRemaining: result.undoRemaining }))
          } else {
            socket.send(JSON.stringify({ type: 'undo_result', gameId: gid, success: false, undoRemaining: result.undoRemaining }))
          }
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
  // ?include=annotations 时附带诊断标注(与 /games/:id/diagnosis 合一的数据源)
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
    const include = String((req.query as { include?: string }).include ?? '')
    if (include.split(',').includes('annotations')) {
      return { game, moves, messages: msgs, annotations: analysis.getAnnotations(numId) }
    }
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
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
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
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'invalid id' })
    const game = repo.getGame(id)
    if (!game) return reply.code(404).send({ error: 'not found' })
    // 已答对的手不再出题(原来练对了下次还出同一题)
    const solved = training.correctPlies(id)
    const annotations = analysis.getAnnotations(id).filter(a => !solved.has(a.ply))
    const drills = generateDrills({
      gameId: id, humanSide: game.humanSide, startFen: game.startFen,
      moves: repo.getMoves(id), annotations,
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
  app.get('/compare', async (req) => {
    // ?side=red|black 只比该执方的局(红黑不再混池);排序已改按对局真实开始时间
    const q = req.query as { side?: string }
    const side = q.side === 'red' || q.side === 'black' ? q.side : undefined
    const all = analysis.listGrowthMetrics(side)
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

  // 合法走法查询：GET /legal-moves?fen=...&square=...
  app.get('/legal-moves', async (req, reply) => {
    const query = req.query as { fen?: string; square?: string }
    const fen = String(query.fen ?? '')
    const square = String(query.square ?? '')
    if (!fen || !square || square.length !== 2) {
      return reply.code(400).send({ error: 'fen 和 square 参数必填, square 为 2 字符坐标' })
    }
    try {
      const pos = Position.fromFen(fen) as any
      const allMoves = pos.legalMoves() as string[]
      const squares = allMoves
        .filter((m: string) => m.startsWith(square))
        .map((m: string) => m.slice(2, 4))
      return { squares }
    } catch (e) {
      return reply.code(400).send({ error: 'FEN 解析失败' })
    }
  })

  // 棋谱导入：POST /games/import
  // body: { startFen?, moves: string[], mode?, result? }
  // 校验失败 → 400；成功 → { gameId }
  app.post('/games/import', async (req, reply) => {
    // 安全:导入是写库操作,与 /admin 同口径限本机(修 R-8;控制台同机使用不受影响,
    // 挡住服务绑非 loopback 时的远程建局写库)
    const ip = req.ip
    if (!(ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1')) {
      return reply.code(403).send({ error: '导入接口仅限本机访问' })
    }
    let validated: ReturnType<typeof validateImport>
    try {
      const body = req.body as {
        startFen?: string; moves?: unknown; mode?: string; result?: string
        humanSide?: string; createdAt?: string; endedAt?: string | null; scoreCps?: unknown[]; byAis?: unknown[]
      }
      if (!Array.isArray(body?.moves)) {
        return reply.code(400).send({ error: 'moves 必须为字符串数组' })
      }
      validated = validateImport({
        startFen: body.startFen,
        moves: body.moves as string[],
        mode: body.mode,
        result: body.result,
        humanSide: body.humanSide,
        createdAt: body.createdAt,
        endedAt: body.endedAt,
        scoreCps: body.scoreCps,
        byAis: body.byAis,
      })
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }

    const { startFen, moves, mode, result, humanSide, createdAt, endedAt, scoreCps, byAis } = validated
    const now = new Date().toISOString()

    // 保真导入:humanSide/原始时间戳/逐手评分/AI 标记全部还原(旧格式缺省 red/导入时刻/null/false)
    const gameId = repo.createGame({ mode: mode as GameMode, humanSide, startFen, startedAt: createdAt ?? now })

    // 逐手重放写入 moves 表；side 从 startFen 起算交替
    let pos = Position.fromFen(startFen)
    for (let i = 0; i < moves.length; i++) {
      const move = moves[i]
      const side = pos.sideToMove()
      const nextPos = pos.applyMove(move)
      repo.addMove({
        gameId,
        side,
        move,
        fenAfter: nextPos.fen(),
        scoreCp: scoreCps[i],
        byAi: byAis[i],
      })
      pos = nextPos
    }

    // 如果有结果，补写 finishGame(还原原始 endedAt,缺省才用 now——修 R-5 战绩污染)
    if (result !== null) {
      repo.finishGame(gameId, result, endedAt ?? now)
    }

    return { gameId }
  })

  // ── 云 TTS 合成(qwen3-tts-flash) ────────────────────────────────────────────
  // GET /tts?personaId=xxx&text=xxx
  // 成功 → JSON { url }(OSS 公网音频 URL);失败 → 503(前端回退浏览器 TTS)
  app.get('/tts', async (req, reply) => {
    const query = req.query as { personaId?: string; text?: string }
    const personaId = String(query.personaId ?? '')
    const rawText = String(query.text ?? '').trim()
    if (!rawText) return reply.code(400).send({ error: 'text 参数不能为空' })
    const text = rawText.slice(0, 500)
    try {
      const url = await synthesizeUrl(text, voiceForPersona(personaId), {
        endpoint: process.env.DASHSCOPE_TTS_ENDPOINT ?? '',
        apiKey: process.env.DASHSCOPE_API_KEY ?? '',
        model: process.env.DASHSCOPE_TTS_MODEL ?? 'qwen3-tts-flash',
      })
      return reply.header('Content-Type', 'application/json').send({ url })
    } catch (e) {
      req.log.error(e, 'TTS 合成失败')
      return reply.code(503).send({ error: 'TTS 服务暂时不可用' })
    }
  })

  // 语音识别:POST /asr?mime=audio/wav,body 为原始音频字节(application/octet-stream)
  // 注入 opts.asr → 跳过 key 检查;否则需 DASHSCOPE 凭据,缺失则 503
  app.post('/asr', { bodyLimit: 4 * 1024 * 1024 }, async (req, reply) => {
    const mime = String((req.query as { mime?: string }).mime ?? 'audio/wav')
    if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) return reply.code(400).send({ error: 'mime 非法' })
    const audio = req.body as Buffer
    if (!Buffer.isBuffer(audio) || audio.length === 0) return reply.code(400).send({ error: '音频为空' })
    let asr = opts.asr
    if (!asr) {
      const llm = cfg.getLlm()
      if (!llm.apiKey || !llm.baseURL) return reply.code(503).send({ error: '未配置 DASHSCOPE,语音识别不可用' })
      asr = new DashscopeAsr(process.env.ASR_MODEL ?? 'qwen3-asr-flash', llm.apiKey, llm.baseURL)
    }
    try {
      const text = await asr.transcribe(audio, mime)
      return reply.send({ text })
    } catch (e) {
      req.log.error(e, 'ASR 识别失败')
      return reply.code(500).send({ error: '语音识别服务暂时不可用' })
    }
  })

  return app
}
