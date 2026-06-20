import type { LLMProvider } from '../llm/provider.js'
import type { CompareReport } from './compare.js'

/**
 * 把规则对比数据喂给 LLM，产出中文自然语言成长点评（3-5 句）。
 * 若 LLM 返回空串（降级 / FakeLLM 无配置），则回退到规则版 summary。
 */
export async function growthReport(
  llm: LLMProvider,
  compareData: CompareReport,
): Promise<string> {
  // 样本不足时直接回退，无需消耗 token
  if (compareData.before.games === 0 || compareData.after.games === 0) {
    return compareData.summary
  }

  const { before: b, after: a, deltas: d } = compareData

  const prompt = `你是中国象棋 AI 教练，请根据以下数据对棋手的进步做简洁点评（中文，3-5 句）：
- 此前 ${b.games} 局：估算棋力 ${b.estElo}，ACPL ${b.acpl}，准确率 ${b.accuracy}%，每局漏着 ${b.blundersPerGame}
- 近期 ${a.games} 局：估算棋力 ${a.estElo}，ACPL ${a.acpl}，准确率 ${a.accuracy}%，每局漏着 ${a.blundersPerGame}
- 变化：棋力 ${d.estElo > 0 ? '+' : ''}${d.estElo}，ACPL ${d.acpl > 0 ? '+' : ''}${d.acpl}，漏着/局 ${d.blundersPerGame > 0 ? '+' : ''}${d.blundersPerGame}

请指出：进步在哪、仍存在什么缺陷、给出一条具体建议。不要列点，直接用自然段落。`

  try {
    const reply = await llm.chat(
      [
        { role: 'system', content: '你是专业的中国象棋教练，擅长用简洁中文点评棋手成长。' },
        { role: 'user', content: prompt },
      ],
      { disableThinking: true, maxTokens: 300, temperature: 0.7 },
    )

    const text = reply.trim()
    // LLM 返回空串 → 降级回规则 summary
    return text !== '' ? text : compareData.summary
  } catch {
    // LLM 调用异常 → 降级回规则 summary
    return compareData.summary
  }
}
