import type { FastifyInstance } from 'fastify'
import type { RuntimeConfig } from '../config/runtime-config.js'
import type { MemoryStore, MemoryKind, MemoryListFilter } from '../memory/store.js'
import type { GamesRepo } from '../store/games-repo.js'
import type { MessagesRepo } from '../store/messages-repo.js'
import { DEFAULTS, type ConfigSection } from '../config/defaults.js'
import { PERSONAS } from '../personas/personas.js'
import { maskKey } from './mask.js'

export interface AdminDeps {
  cfg: RuntimeConfig
  mem: MemoryStore
  games: GamesRepo
  messages: MessagesRepo
}

const SECTIONS = Object.keys(DEFAULTS) as ConfigSection[]

export function registerAdminRoutes(app: FastifyInstance, deps: AdminDeps): void {
  const { cfg } = deps

  // 安全加固:/admin/* 仅限本机(loopback)访问。控制台与服务端同机,正常使用不受影响;
  // 但当服务被绑到非 loopback 接口时,可挡住远程读取明文 key(/reveal)与篡改配置。
  const isLoopback = (ip: string | undefined): boolean =>
    ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
  app.addHook('onRequest', async (req, reply) => {
    if (!req.url.startsWith('/admin')) return
    if (!isLoopback(req.ip)) return reply.code(403).send({ error: 'admin 接口仅限本机访问' })
  })

  app.get('/admin/config', async () => {
    const llm = cfg.getLlm()
    return {
      chat: cfg.getChat(),
      director: cfg.getDirectorDefaults(),
      engine: cfg.getEngineParams(),
      diagnose: cfg.getDiagnose(),
      llm: { ...llm, apiKey: maskKey(llm.apiKey) },
      tts: cfg.getTts(),
      personas: cfg.personaConfigs(),
    }
  })

  app.get('/admin/config/llm/reveal', async () => ({ apiKey: cfg.getLlm().apiKey }))

  app.put('/admin/config/:section', async (req, reply) => {
    const { section } = req.params as { section: string }
    if (!SECTIONS.includes(section as ConfigSection)) return reply.code(400).send({ error: `unknown section: ${section}` })
    const patch = (req.body ?? {}) as Record<string, unknown>
    try {
      cfg.updateSection(section as ConfigSection, patch)
    } catch (err) {
      return reply.code(400).send({ error: (err as Error).message })
    }
    return { ok: true }
  })

  registerPersonaRoutes(app, deps)
  registerMemoryRoutes(app, deps)
  registerGamesRoutes(app, deps)
}

const PERSONA_IDS: readonly string[] = PERSONAS.map(p => p.id)
function registerPersonaRoutes(app: FastifyInstance, { cfg }: AdminDeps): void {
  app.get('/admin/personas', async () => cfg.personaConfigs())

  app.put('/admin/personas/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!PERSONA_IDS.includes(id)) return reply.code(400).send({ error: `unknown persona: ${id}` })
    const b = (req.body ?? {}) as Record<string, unknown>
    const patch: Record<string, unknown> = {}
    for (const k of ['name', 'skill', 'background', 'voiceStyle', 'leaning', 'ttsVoice'] as const) {
      if (typeof b[k] === 'string' && (b[k] as string).trim() !== '') patch[k] = b[k]
    }
    if (typeof b.enabled === 'boolean') patch.enabled = b.enabled
    cfg.updatePersona(id as any, patch)
    return { ok: true }
  })

  app.post('/admin/personas/:id/reset', async (req, reply) => {
    const { id } = req.params as { id: string }
    if (!PERSONA_IDS.includes(id)) return reply.code(400).send({ error: `unknown persona: ${id}` })
    cfg.resetPersona(id as any)
    return { ok: true }
  })
}
function registerMemoryRoutes(app: FastifyInstance, { mem }: AdminDeps): void {
  app.get('/admin/memory', async (req, reply) => {
    const q = req.query as { personaId?: string; kind?: string; includeSuperseded?: string }
    const filter: MemoryListFilter = {}
    if (q.personaId) {
      if (!PERSONA_IDS.includes(q.personaId as any)) return reply.code(400).send({ error: 'unknown persona' })
      filter.personaId = q.personaId as any
    }
    if (q.kind) filter.kind = q.kind as MemoryKind
    if (q.includeSuperseded === 'true') filter.includeSuperseded = true
    return mem.list(filter)
  })

  app.put('/admin/memory/:id', async (req, reply) => {
    const { id } = req.params as { id: string }
    const b = (req.body ?? {}) as { content?: string; importance?: number }
    const patch: { content?: string; importance?: number } = {}
    if (typeof b.content === 'string' && b.content.trim() !== '') patch.content = b.content
    if (typeof b.importance === 'number') patch.importance = Math.max(1, Math.min(5, Math.round(b.importance)))
    if (!('content' in patch) && !('importance' in patch)) return reply.code(400).send({ error: 'nothing to update' })
    await mem.update(id, patch)
    return { ok: true }
  })

  app.delete('/admin/memory/:id', async (req) => {
    const { id } = req.params as { id: string }
    await mem.remove(id)
    return { ok: true }
  })
}
function registerGamesRoutes(app: FastifyInstance, { games, messages }: AdminDeps): void {
  app.get('/admin/games', async () => games.listGames())

  app.get('/admin/games/:id', async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(id)) return reply.code(400).send({ error: 'invalid id' })
    const game = games.getGame(id)
    if (!game) return reply.code(404).send({ error: 'not found' })
    return { game, moves: games.getMoves(id), messages: messages.getMessages(id) }
  })

  app.delete('/admin/games/:id', async (req, reply) => {
    const id = parseInt((req.params as { id: string }).id, 10)
    if (isNaN(id)) return reply.code(400).send({ error: 'invalid id' })
    games.deleteGame(id)
    return { ok: true }
  })
}
