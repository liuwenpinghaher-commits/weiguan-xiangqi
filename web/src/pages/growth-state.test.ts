import { describe, expect, it } from 'vitest'
import { compareText, weaknessText } from './growth-state.js'

describe('growth-state helpers', () => {
  it('弱点画像失败和空样本使用不同文案', () => {
    expect(weaknessText(0, null)).toContain('暂无失误样本')
    expect(weaknessText(0, 'HTTP 500')).toContain('弱点画像加载失败')
  })

  it('成长点评失败和无历史对比使用不同文案', () => {
    expect(compareText({ loading: true, reportText: null, error: null })).toBe('加载中…')
    expect(compareText({ loading: false, reportText: null, error: 'HTTP 500' })).toContain('成长点评加载失败')
    expect(compareText({ loading: false, reportText: null, error: null })).toBe('暂无历史对比数据')
    expect(compareText({ loading: false, reportText: '最近明显稳定', error: null })).toBe('最近明显稳定')
  })
})
