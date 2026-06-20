import type { PersonaMemoryRepo } from './persona-memory-repo.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId } from '../types.js'
import { getPersona } from '../personas/personas.js'

export async function reflect(args: {
  repo: PersonaMemoryRepo; llm: LLMProvider; personaId: PersonaId; gameId: number; now: () => number
}): Promise<void> {
  const { repo, llm, personaId, now } = args
  const recent = repo.byPersona(personaId).filter(m => m.kind !== 'insight').slice(0, 20)
  if (recent.length === 0) return
  const persona = getPersona(personaId)
  const bullets = recent.map(m => '- ' + m.content).join('\n')
  const insight = (await llm.chat([
    { role: 'system', content: `你是${persona.name}。把对该玩家的零散观察,抽象成一条更高层、可复用的洞见(一句话,中文)。` },
    { role: 'user', content: `观察:\n${bullets}\n\n请给出一条洞见:` },
  ], { disableThinking: false, maxTokens: 120 })).trim()
  if (!insight) return
  repo.add({ personaId, kind: 'insight', content: insight, importance: 4, gameId: args.gameId,
    createdAt: new Date(now()).toISOString() })
}
