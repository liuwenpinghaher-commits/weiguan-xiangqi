import { describe, expect, it } from 'vitest'
import { resolveDbPath } from './runtime-paths.js'

describe('runtime paths', () => {
  it('未配置 DB_PATH 时使用用户目录下的确定性绝对路径', () => {
    expect(resolveDbPath(undefined, { cwd: '/repo', home: '/Users/tester' })).toBe('/Users/tester/.weiguan-xiangqi/weiguan.sqlite')
  })

  it('相对 DB_PATH 按启动 cwd 解析为绝对路径', () => {
    expect(resolveDbPath('./data/dev.sqlite', { cwd: '/repo', home: '/Users/tester' })).toBe('/repo/data/dev.sqlite')
  })

  it('绝对 DB_PATH 原样保留', () => {
    expect(resolveDbPath('/tmp/weiguan.sqlite', { cwd: '/repo', home: '/Users/tester' })).toBe('/tmp/weiguan.sqlite')
  })
})
