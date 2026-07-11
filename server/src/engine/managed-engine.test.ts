import { describe, expect, it } from 'vitest'
import { ManagedEngine } from './managed-engine.js'
import type { EngineLine } from '../types.js'

const line: EngineLine = { multipv: 1, move: 'h2e2', scoreCp: 10, mate: null, pv: ['h2e2'] }

describe('ManagedEngine', () => {
  it('底层 analyze 失败后会标记 degraded,重建并重试当前请求', async () => {
    let created = 0
    const engine = new ManagedEngine(() => {
      created += 1
      if (created === 1) {
        return {
          analyze: async () => { throw new Error('engine process closed') },
          close: () => {},
        }
      }
      return {
        analyze: async () => [line],
        close: () => {},
      }
    })

    await expect(engine.analyze('fen', { multipv: 1 })).resolves.toEqual([line])
    expect(created).toBe(2)
    expect(engine.status()).toMatchObject({ configured: true, degraded: false })
  })

  it('重建后仍失败时保持 degraded 状态并暴露原因', async () => {
    const engine = new ManagedEngine(() => ({
      analyze: async () => { throw new Error('still down') },
      close: () => {},
    }))

    await expect(engine.analyze('fen', { multipv: 1 })).rejects.toThrow('still down')
    expect(engine.status()).toMatchObject({ configured: true, degraded: true })
    expect(engine.status().reason).toContain('still down')
  })
})
