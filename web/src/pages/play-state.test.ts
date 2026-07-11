import { describe, expect, it } from 'vitest'
import { engineStatusHint, nextStatusFromState, postGameAnalysisHint, primaryActionKind, shouldAcceptChat, shouldAwaitAiOnStarted } from './play-state.js'

describe('play-state helpers', () => {
  it('无当前 gameId 时不接收任何 chat,避免空闲/建局串台', () => {
    expect(shouldAcceptChat(null, 1)).toBe(false)
    expect(shouldAcceptChat(2, 1)).toBe(false)
    expect(shouldAcceptChat(2, 2)).toBe(true)
  })

  it('resync state 优先恢复终局,其次暂停,否则 playing', () => {
    expect(nextStatusFromState({ over: true, paused: true })).toBe('over')
    expect(nextStatusFromState({ over: false, paused: true })).toBe('paused')
    expect(nextStatusFromState({ over: false, paused: false })).toBe('playing')
  })

  it('执黑 started 后需要等待 AI 先手 update', () => {
    expect(shouldAwaitAiOnStarted('black')).toBe(true)
    expect(shouldAwaitAiOnStarted('red')).toBe(false)
  })

  it('终局/错误状态的主按钮应走完整 restart 清理', () => {
    expect(primaryActionKind('idle')).toBe('start')
    expect(primaryActionKind('over')).toBe('restart')
    expect(primaryActionKind('error')).toBe('restart')
  })

  it('终局分析提示按诊断状态显示,不无条件宣称已自动诊断', () => {
    expect(postGameAnalysisHint({ status: 'ok' })).toContain('已完成诊断')
    expect(postGameAnalysisHint({ status: 'failed', error: 'engine boom' })).toContain('自动诊断失败')
    expect(postGameAnalysisHint({ status: 'pending' })).toContain('可在分析页诊断')
    expect(postGameAnalysisHint()).toContain('已触发局后诊断')
  })

  it('引擎状态提示能把 degraded/未配置转成人可见文案', () => {
    expect(engineStatusHint({ configured: true, degraded: false, reason: null })).toBeNull()
    expect(engineStatusHint({ configured: false, degraded: true, reason: '引擎未配置' })).toContain('引擎不可用')
    expect(engineStatusHint({ configured: true, degraded: true, reason: 'engine process closed' })).toContain('引擎异常')
  })
})
