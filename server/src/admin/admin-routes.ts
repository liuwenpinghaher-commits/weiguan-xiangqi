import type { FastifyInstance } from 'fastify'
import type { RuntimeConfig } from '../config/runtime-config.js'
import type { MemoryStore } from '../memory/store.js'
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

// 占位:Task 9–11 在本文件实现这三个函数。先给空实现让 Task 8 编译通过。
function registerPersonaRoutes(_app: FastifyInstance, _deps: AdminDeps): void {}
function registerMemoryRoutes(_app: FastifyInstance, _deps: AdminDeps): void {}
function registerGamesRoutes(_app: FastifyInstance, _deps: AdminDeps): void {}
