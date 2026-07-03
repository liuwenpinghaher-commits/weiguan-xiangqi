/**
 * ws-client 重连/队列回归测试
 *
 * 锁定修复:重连 5 次全失败 → onStatus('closed') 后置 dead=true,
 * 此后 send 直接丢弃(console.warn),不再入 pendingQueue(防内存泄漏)。
 * 主动 close 后 send 同样丢弃。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// 受控的 WebSocket 桩:可手动触发 onopen/onclose;记录每次 send。
class FakeWS {
  static OPEN = 1
  static CONNECTING = 0
  static instances: FakeWS[] = []
  readyState = FakeWS.CONNECTING
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  onmessage: ((e: { data: string }) => void) | null = null
  sent: string[] = []
  closed = false
  constructor(public url: string) { FakeWS.instances.push(this) }
  send(data: string) { this.sent.push(data) }
  close() { this.closed = true }
  open() { this.readyState = FakeWS.OPEN; this.onopen?.() }
  fireClose() { this.readyState = 3; this.onclose?.() }
}

describe('ws-client 队列与 dead 标志', () => {
  beforeEach(() => {
    FakeWS.instances = []
    vi.stubGlobal('WebSocket', FakeWS as unknown as typeof WebSocket)
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('重连耗尽后 send 丢弃而非无界入队', async () => {
    const { connect } = await import('./ws-client.js')
    const statuses: string[] = []
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = connect(() => {}, (s) => statuses.push(s))

    // 初始连接 + 5 次重连全部失败:每次 fireClose 后推进定时器触发下一次 createWs。
    // RECONNECT_DELAYS_MS = [500,1000,2000,4000,8000] 共 5 次重连。
    FakeWS.instances[0].fireClose()
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(8000)
      const ws = FakeWS.instances[FakeWS.instances.length - 1]
      ws.fireClose()
    }

    expect(statuses[statuses.length - 1]).toBe('closed')

    // dead 之后 send 应被丢弃:不进任何 ws.send,且打印 warn。
    client.send({ type: 'move', gameId: 1, move: 'h2e2' })
    const totalSent = FakeWS.instances.reduce((n, w) => n + w.sent.length, 0)
    expect(totalSent).toBe(0)
    expect(warn).toHaveBeenCalled()
  })

  it('open 后 send 直达;主动 close 后 send 丢弃', async () => {
    const { connect } = await import('./ws-client.js')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const client = connect(() => {})

    const ws = FakeWS.instances[0]
    ws.open()
    client.send({ type: 'pause', gameId: 1 })
    expect(ws.sent).toHaveLength(1)

    client.close()
    ws.readyState = 3
    client.send({ type: 'resume', gameId: 1 })
    expect(ws.sent).toHaveLength(1) // 未新增
    expect(warn).toHaveBeenCalled()
  })
})
