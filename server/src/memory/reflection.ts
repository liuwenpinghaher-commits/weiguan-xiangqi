import type { MemoryStore } from './store.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId, Persona } from '../types.js'
import { getPersona as staticGetPersona } from '../personas/personas.js'

/**
 * 解析 LLM 反思输出,提取 fact 和 insight。
 *
 * 格式约定(LLM 被 prompt 要求遵守):
 *   - 每条具体事实以 "- " 开头(每行一条)
 *   - 最后一行以 "洞见:" 或 "洞见：" 开头,给一句总括 insight
 *
 * 容忍偏差:
 *   - 若无 "- " 行但有 "洞见:",仅写 insight
 *   - 若有 "- " 行但无 "洞见:",则所有 "- " 行写成 fact(无 insight)
 *   - 若两者都无(纯散文),整段写成 1 条 insight
 *   - LLM 输出为空时返回空数组
 */
function parseReflection(raw: string): Array<{ kind: 'fact' | 'insight'; content: string; importance: number }> {
  const text = raw.trim()
  if (!text) return []

  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)

  const factLines: string[] = []
  let insightLine: string | null = null

  for (const line of lines) {
    if (line.startsWith('- ')) {
      factLines.push(line.slice(2).trim())
    } else if (/^洞见[：:]/.test(line)) {
      insightLine = line.replace(/^洞见[：:]\s*/, '').trim()
    }
    // 其他行忽略(可能是空行或无关文字)
  }

  const result: Array<{ kind: 'fact' | 'insight'; content: string; importance: number }> = []

  if (factLines.length > 0) {
    for (const content of factLines) {
      if (content) result.push({ kind: 'fact', content, importance: 3 })
    }
    if (insightLine) {
      result.push({ kind: 'insight', content: insightLine, importance: 4 })
    }
    // 有 fact 但无 insight:只写 fact,不强加 insight
  } else if (insightLine) {
    // 无 "- " 行,只有 "洞见:" → 只写 insight
    result.push({ kind: 'insight', content: insightLine, importance: 4 })
  } else {
    // 纯散文:整段写成 1 条 insight
    result.push({ kind: 'insight', content: text, importance: 4 })
  }

  return result
}

export async function reflect(args: {
  store: MemoryStore; llm: LLMProvider; personaId: PersonaId; gameId: number; now: () => number
  playerSummary: string
  /** 取运行时 persona(含控制台覆盖);省略时回退静态 personas。 */
  getPersona?: (id: PersonaId) => Persona
}): Promise<void> {
  const { store, llm, personaId, now, playerSummary } = args
  if (!playerSummary) return
  const persona = (args.getPersona ?? staticGetPersona)(personaId)

  const raw = (await llm.chat([
    { role: 'system', content: `你是${persona.name}。` },
    {
      role: 'user',
      content: `这位棋手本局的走法:\n${playerSummary}\n`
        + `请先列出 2-3 条关于这位棋手的具体事实(每行以 "- " 开头,如"- 爱走当头炮"、"- 残局易急躁"),`
        + `最后一行以"洞见: "开头,给一句更高层次的总括性洞见。全部用中文回答。`,
    },
  ], { disableThinking: false, maxTokens: 200 })).trim()

  if (!raw) return

  const entries = parseReflection(raw)
  const createdAt = new Date(now()).toISOString()

  for (const entry of entries) {
    await store.record({
      personaId,
      kind: entry.kind,
      content: entry.content,
      importance: entry.importance,
      gameId: args.gameId,
      createdAt,
    })
  }
}

// 导出解析函数供测试直接验证(可选,不破坏封装)
export { parseReflection }
