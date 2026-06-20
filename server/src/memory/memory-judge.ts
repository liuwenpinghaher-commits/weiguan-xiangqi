import type { LLMProvider } from '../llm/provider.js'

export type JudgeResult =
  | { action: 'merge'; merged: string }
  | { action: 'supersede' }
  | { action: 'keep' }

/** 解析裁决文本。容忍偏差:无法识别一律回退 keep(最安全:既不合并也不作废)。 */
export function parseJudge(raw: string): JudgeResult {
  // 容忍 markdown 代码块/反引号包裹,并只取首个非空行
  // (模型开推理时可能在裁决行后附带解释,绝不能让解释污染 merged 文本)
  const cleaned = raw.replace(/```[^\n]*\n?/g, '').replace(/`/g, '')
  const text = (cleaned.split('\n').map((l) => l.trim()).find(Boolean) ?? '')
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
  ], { disableThinking: false /* 需要推理判断语义关系 */, maxTokens: 120 /* ≈60 汉字,够一句归并 */ })
  return parseJudge(raw)
}
