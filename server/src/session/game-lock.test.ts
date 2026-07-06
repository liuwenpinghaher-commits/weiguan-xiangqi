import { test, expect } from 'vitest'
import { createGameLock } from './game-lock.js'

const defer = () => {
  let resolve!: () => void
  const p = new Promise<void>((r) => { resolve = r })
  return { p, resolve }
}

test('同一对局的操作串行执行:后到者必须等前一个完成', async () => {
  const withGameLock = createGameLock()
  const order: string[] = []
  const a = defer()

  // op1 卡在 a.p 上不结束
  const p1 = withGameLock(1, async () => { order.push('op1-start'); await a.p; order.push('op1-end') })
  // op2 排在同一 gid 后面:在 op1 结束前绝不能开始
  const p2 = withGameLock(1, async () => { order.push('op2-start') })

  await Promise.resolve()
  await Promise.resolve()
  expect(order).toEqual(['op1-start']) // op2 尚未开始
  a.resolve()
  await Promise.all([p1, p2])
  expect(order).toEqual(['op1-start', 'op1-end', 'op2-start'])
})

test('不同对局互不阻塞:可并发进行', async () => {
  const withGameLock = createGameLock()
  const order: string[] = []
  const a = defer()
  const p1 = withGameLock(1, async () => { order.push('g1-start'); await a.p })
  const p2 = withGameLock(2, async () => { order.push('g2-start') })
  await p2 // g2 不必等 g1
  expect(order).toContain('g2-start')
  a.resolve()
  await p1
})

test('前一个操作抛错不断链:后续操作照常执行,且错误照常抛给调用方', async () => {
  const withGameLock = createGameLock()
  const order: string[] = []
  const p1 = withGameLock(1, async () => { throw new Error('boom') })
  const p2 = withGameLock(1, async () => { order.push('op2') })
  await expect(p1).rejects.toThrow('boom')
  await p2
  expect(order).toEqual(['op2'])
})
