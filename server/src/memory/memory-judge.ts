import type { LLMProvider } from '../llm/provider.js'

export type JudgeResult =
  | { action: 'merge'; merged: string }
  | { action: 'supersede' }
  | { action: 'keep' }

/** 解析裁决文本。容忍偏差:无法识别一律回退 keep(最安全:既不合并也不作废)。 */
export function parseJudge(raw: string): JudgeResult {
  const text = raw.trim()
  const lower = text.toLowerCase()
  if (lower.startsWith('merge')) {
    const merged = text.replace(/^merge\s*[:：]?\s*/i, '').trim()
    return merged ? { action: 'merge', merged } : { action: 'keep' }
  }
  if (lower.startsWith('supersede')) return { action: 'supersede' }
  if (lower.startsWith('keep')) return { action: 'keep' }
  return { action: 'keep' }
}

/** 让 LLM 判断"新记忆 vs 最相似的已有记忆"的关系。 */
export async function judgeMemory(llm: LLMProvider, existing: string, incoming: string): Promise<JudgeResult> {
  const raw = await llm.chat([
    {
      role: 'system',
      content: '你在维护一个对弈对手的人设记忆库。给你"已有记忆"和"新记忆",判断二者关系并只输出一行:\n'
        + '- 若是同一事实的复述/细化 → 输出 "merge: <合并后的一句话>"\n'
        + '- 若新记忆与旧记忆矛盾、是认知更新 → 输出 "supersede"\n'
        + '- 若相关但确为不同的事实 → 输出 "keep"\n'
        + '只输出这一行,不要解释。',
    },
    { role: 'user', content: `已有记忆:${existing}\n新记忆:${incoming}` },
  ], { disableThinking: false, maxTokens: 120 })
  return parseJudge(raw)
}
