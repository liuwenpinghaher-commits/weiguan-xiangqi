import { describe, it, expect, vi } from 'vitest'
import { withLLMRetry, isRetryable } from './dashscope.js'

const noSleep = async () => {}

describe('isRetryable', () => {
  it('429 / 5xx 可重试', () => {
    expect(isRetryable({ status: 429 })).toBe(true)
    expect(isRetryable({ status: 500 })).toBe(true)
    expect(isRetryable({ status: 503 })).toBe(true)
  })
  it('4xx(非 429)不可重试', () => {
    expect(isRetryable({ status: 400 })).toBe(false)
    expect(isRetryable({ status: 401 })).toBe(false)
    expect(isRetryable({ status: 404 })).toBe(false)
  })
  it('无 status(网络/超时错误)可重试', () => {
    expect(isRetryable(new Error('socket hang up'))).toBe(true)
    expect(isRetryable(null)).toBe(true)
  })
})

describe('withLLMRetry', () => {
  it('成功路径只调用一次(不重试)', async () => {
    const fn = vi.fn(async () => 'ok')
    const r = await withLLMRetry(fn, [300, 800], noSleep)
    expect(r).toBe('ok')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('5xx 失败后重试,最终成功', async () => {
    let n = 0
    const fn = vi.fn(async () => {
      if (n++ === 0) throw Object.assign(new Error('boom'), { status: 500 })
      return 'recovered'
    })
    const r = await withLLMRetry(fn, [300, 800], noSleep)
    expect(r).toBe('recovered')
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('429 持续失败 → 重试耗尽后抛同类错误', async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error('rate'), { status: 429 })
    })
    await expect(withLLMRetry(fn, [10, 20], noSleep)).rejects.toThrow(/rate/)
    // 1 次初试 + 2 次重试 = 3
    expect(fn).toHaveBeenCalledTimes(3)
  })

  it('4xx(非 429)立即抛,不重试', async () => {
    const fn = vi.fn(async () => {
      throw Object.assign(new Error('bad request'), { status: 400 })
    })
    await expect(withLLMRetry(fn, [10, 20], noSleep)).rejects.toThrow(/bad request/)
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('按退避序列 sleep,次数与重试次数一致', async () => {
    const sleeps: number[] = []
    const sleep = async (ms: number) => { sleeps.push(ms) }
    let n = 0
    const fn = async () => {
      if (n++ < 2) throw Object.assign(new Error('x'), { status: 503 })
      return 'ok'
    }
    const r = await withLLMRetry(fn, [300, 800], sleep)
    expect(r).toBe('ok')
    expect(sleeps).toEqual([300, 800])
  })
})
