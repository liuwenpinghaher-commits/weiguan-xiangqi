import { describe, it, expect } from 'vitest'
import { judgeMemory, parseJudge } from './memory-judge.js'
import { FakeLLM } from '../llm/fake.js'

describe('parseJudge', () => {
  it('解析 merge + 归并文本', () => {
    expect(parseJudge('merge: 爱走当头炮,且常接马后炮')).toEqual({ action: 'merge', merged: '爱走当头炮,且常接马后炮' })
  })
  it('解析 supersede', () => {
    expect(parseJudge('supersede')).toEqual({ action: 'supersede' })
  })
  it('解析 keep', () => {
    expect(parseJudge('keep')).toEqual({ action: 'keep' })
  })
  it('无法识别时回退 keep(安全:不动旧记忆)', () => {
    expect(parseJudge('啊我不知道')).toEqual({ action: 'keep' })
  })
})

describe('judgeMemory', () => {
  it('把已有/新记忆喂给 LLM 并解析其裁决', async () => {
    const llm = new FakeLLM(['supersede'])
    const r = await judgeMemory(llm, '残局易急躁', '残局变稳健了')
    expect(r).toEqual({ action: 'supersede' })
    // 确认 prompt 里带了两条内容
    const sent = llm.calls[0].messages.map(m => m.content).join('\n')
    expect(sent).toContain('残局易急躁')
    expect(sent).toContain('残局变稳健了')
  })
})
