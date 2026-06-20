import type { FastifyInstance } from 'fastify'
import type { RuntimeConfig } from '../config/runtime-config.js'
import type { MemoryStore, MemoryKind, MemoryListFilter } from '../memory/store.js'
import type { GamesRepo } from '../store/games-repo.js'
import type { MessagesRepo } from '../store/messages-repo.js'
import { DEFAULTS, type ConfigSection } from '../config/defaults.js'
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

const PERSONA_IDS = ['player', 'laopaoer', 'coach', 'netizen']
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
  app.get('/admin/memory', async (req) => {
    const q = req.query as { personaId?: string; kind?: string; includeSuperseded?: string }
    const filter: MemoryListFilter = {}
    if (q.personaId) filter.personaId = q.personaId as any
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
function registerGamesRoutes(_app: FastifyInstance, _deps: AdminDeps): void {}
