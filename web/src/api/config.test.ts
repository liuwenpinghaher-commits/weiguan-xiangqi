import { describe, expect, it } from 'vitest'
import { resolveApiBases } from './config.js'

describe('api config', () => {
  it('未显式配置 VITE_API_BASE 时固定本机后端,不按页面 hostname 暗示局域网可用', () => {
    expect(resolveApiBases(undefined, '192.168.1.8')).toEqual({
      httpBase: 'http://localhost:3410',
      wsBase: 'ws://localhost:3410',
    })
  })

  it('显式 VITE_API_BASE 时允许自定义后端地址', () => {
    expect(resolveApiBases('http://192.168.1.8:3410', 'localhost')).toEqual({
      httpBase: 'http://192.168.1.8:3410',
      wsBase: 'ws://192.168.1.8:3410',
    })
  })
})
