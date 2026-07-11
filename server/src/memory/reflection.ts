import type { MemoryStore } from './store.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId, Persona } from '../types.js'
import { getPersona as staticGetPersona } from '../personas/personas.js'

type ReflectionSide = 'red' | 'black'
type ReflectionResult = ReflectionSide | 'draw' | null
type ReflectionAnnotation = {
  ply: number
  side: ReflectionSide
  phase: string
  theme: string
  cpLoss: number
  bestMove: string
}
type ReflectionMessage = {
  role: string
  personaId: string
  text: string
  addressee?: string | null
}
type ReflectionTrainingStats = { total: number; correct: number }

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

function resultText(result: ReflectionResult): string {
  if (result === 'draw') return '和棋'
  if (result === 'red') return '红胜'
  if (result === 'black') return '黑胜'
  return '未结束'
}

export function buildReflectionInput(args: {
  playerMoves: string[]
  humanSide: ReflectionSide
  result: ReflectionResult
  annotations?: ReflectionAnnotation[]
  messages?: ReflectionMessage[]
  trainingStats?: ReflectionTrainingStats
}): string {
  const sections: string[] = []
  if (args.playerMoves.length > 0) {
    sections.push(`人类走法全局概述:\n${args.playerMoves.map((m, i) => `${i + 1}. ${m}`).join('\n')}`)
  }
  sections.push(`人类执方: ${args.humanSide === 'red' ? '红方' : '黑方'}`)
  sections.push(`结果: ${resultText(args.result)}`)

  const humanProblems = (args.annotations ?? [])
    .filter(a => a.side === args.humanSide && a.theme !== 'ok')
    .sort((a, b) => b.cpLoss - a.cpLoss)
    .slice(0, 6)
  if (humanProblems.length > 0) {
    sections.push('关键诊断:\n' + humanProblems.map(a =>
      `第${a.ply}手 ${a.phase}/${a.theme}, 丢${a.cpLoss}分, 建议 ${a.bestMove}`,
    ).join('\n'))
  }

  const relevantMessages = (args.messages ?? [])
    .filter(m => m.role === 'human' || m.addressee === 'human')
    .slice(-8)
  if (relevantMessages.length > 0) {
    sections.push('本局问答:\n' + relevantMessages.map(m =>
      `${m.personaId}${m.addressee ? ` -> ${m.addressee}` : ''}: ${m.text}`,
    ).join('\n'))
  }

  if (args.trainingStats && args.trainingStats.total > 0) {
    sections.push(`训练表现: ${args.trainingStats.correct}/${args.trainingStats.total}`)
  }

  return sections.join('\n\n')
}

export async function reflect(args: {
  store: MemoryStore; llm: LLMProvider; personaId: PersonaId; gameId: number; now: () => number
  playerSummary: string
  contextSummary?: string
  /** 取运行时 persona(含控制台覆盖);省略时回退静态 personas。 */
  getPersona?: (id: PersonaId) => Persona
}): Promise<void> {
  const { store, llm, personaId, now, playerSummary, contextSummary } = args
  if (!playerSummary && !contextSummary) return
  const persona = (args.getPersona ?? staticGetPersona)(personaId)
  const summary = [playerSummary, contextSummary].filter(Boolean).join('\n\n')

  const raw = (await llm.chat([
    { role: 'system', content: `你是${persona.name}。` },
    {
      role: 'user',
      content: `这位棋手本局的走法与局后上下文:\n${summary}\n`
        + `请先列出 2-3 条关于这位棋手的具体事实(每行以 "- " 开头,如"- 爱走当头炮"、"- 残局易急躁"),`
        + `最后一行以"洞见: "开头,给一句更高层次的总括性洞见。全部用中文回答。`,
    },
    // 反思提炼开 think 发挥推理(本地 qwen3.5)。maxTokens 是上限非目标:生成完即停,设大只防思考被截断
  ], { maxTokens: 5000, think: true })).trim()

  if (!raw) return

  const entries = parseReflection(raw)
  const createdAt = new Date(now()).toISOString()

  // 逐条隔离:任一 entry 写入失败不应中断整循环、丢掉后续 entry。失败记 warn 后继续。
  for (const entry of entries) {
    try {
      await store.record({
        personaId,
        kind: entry.kind,
        content: entry.content,
        importance: entry.importance,
        gameId: args.gameId,
        createdAt,
      })
    } catch (err) {
      console.warn(`[reflection] 写入记忆失败(persona=${personaId}, kind=${entry.kind}),跳过该条:`, (err as Error).message)
    }
  }
}

// 导出解析函数供测试直接验证(可选,不破坏封装)
export { parseReflection }
