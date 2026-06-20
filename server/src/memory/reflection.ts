import type { PersonaMemoryRepo } from './persona-memory-repo.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId } from '../types.js'
import { getPersona } from '../personas/personas.js'

export async function reflect(args: {
  repo: PersonaMemoryRepo; llm: LLMProvider; personaId: PersonaId; gameId: number; now: () => number
  playerSummary: string
}): Promise<void> {
  const { repo, llm, personaId, now, playerSummary } = args
  if (!playerSummary) return
  const persona = getPersona(personaId)
  const insight = (await llm.chat([
    { role: 'system', content: `你是${persona.name}。` },
    { role: 'user', content: `这位棋手本局的走法:\n${playerSummary}\n用一句话总结你对这位棋手棋风/毛病的洞见(中文):` },
  ], { disableThinking: false, maxTokens: 120 })).trim()
  if (!insight) return
  repo.add({ personaId, kind: 'insight', content: insight, importance: 4, gameId: args.gameId,
    createdAt: new Date(now()).toISOString() })
}
