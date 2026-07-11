import { describe, expect, it } from 'vitest'
import { trainingAnswerFeedback, trainingBoardDisabled } from './training-state.js'

const drill = {
  bestMove: 'h2e2',
  playedMove: 'h2h7',
}

describe('training-state helpers', () => {
  it('后端保存成功时显示正常判题反馈', () => {
    expect(trainingAnswerFeedback(drill, 'h2e2', true)).toContain('正解')
    expect(trainingAnswerFeedback(drill, 'h2h7', true)).toContain('引擎最佳是 h2e2')
  })

  it('后端提交失败时仍可本地判题,但必须提示未保存', () => {
    const feedback = trainingAnswerFeedback(drill, 'h2e2', false)
    expect(feedback).toContain('正解')
    expect(feedback).toContain('未保存')
  })

  it('训练棋盘提交中或已作答后锁定,切题清空反馈后恢复', () => {
    expect(trainingBoardDisabled(true, '')).toBe(true)
    expect(trainingBoardDisabled(false, '✓ 正解')).toBe(true)
    expect(trainingBoardDisabled(false, '')).toBe(false)
  })
})
