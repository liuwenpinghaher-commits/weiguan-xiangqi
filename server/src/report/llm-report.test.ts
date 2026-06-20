import { test, expect } from 'vitest'
import { growthReport } from './llm-report.js'
import { FakeLLM } from '../llm/fake.js'
import type { CompareReport } from './compare.js'

// 构造一个有效的 CompareReport fixture
const makeReport = (): CompareReport => ({
  before: { games: 5, acpl: 140, accuracy: 68, estElo: 1750, blundersPerGame: 1.5 },
  after:  { games: 5, acpl: 90,  accuracy: 76, estElo: 2050, blundersPerGame: 0.8 },
  deltas: { acpl: -50, accuracy: 8, estElo: 300, blundersPerGame: -0.7 },
  summary: '规则版摘要:棋力提升约 300 分。',
})

test('FakeLLM 返回一段话 → growthReport 返回 LLM 文本', async () => {
  const llm = new FakeLLM(['你最近进步明显，中局控盘能力增强，但残局仍需注意丢子风险，建议多练习残局教材。'])
  const cmp = makeReport()
  const result = await growthReport(llm, cmp)
  expect(result).toBe('你最近进步明显，中局控盘能力增强，但残局仍需注意丢子风险，建议多练习残局教材。')
  // 确认 LLM 被实际调用
  expect(llm.calls).toHaveLength(1)
  // 系统 prompt 应包含"教练"
  expect(llm.calls[0].messages[0].content).toContain('教练')
})

test('FakeLLM 返回空串 → 回退到规则 summary', async () => {
  // fallback='' 队列耗尽后返回空串
  const llm = new FakeLLM([], '')
  const cmp = makeReport()
  const result = await growthReport(llm, cmp)
  expect(result).toBe(cmp.summary)
})

test('样本不足(before.games=0) → 直接回退规则 summary,不调用 LLM', async () => {
  const llm = new FakeLLM(['不应该被调用'])
  const cmp: CompareReport = {
    before: { games: 0, acpl: 0, accuracy: 0, estElo: 0, blundersPerGame: 0 },
    after:  { games: 3, acpl: 80, accuracy: 75, estElo: 2000, blundersPerGame: 0.5 },
    deltas: { acpl: 0, accuracy: 0, estElo: 0, blundersPerGame: 0 },
    summary: '样本不足:两个时间段都需要至少一局已诊断的对局才能对比。',
  }
  const result = await growthReport(llm, cmp)
  expect(result).toBe(cmp.summary)
  // 样本不足时不应调用 LLM
  expect(llm.calls).toHaveLength(0)
})
