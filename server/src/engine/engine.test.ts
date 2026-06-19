import { test, expect, vi } from 'vitest'
import { UciEngine, type Transport } from './engine.js'

/** 测试替身:记录写入的命令,可手动推送引擎输出行 */
class FakeTransport implements Transport {
  written: string[] = []
  private onLine: (l: string) => void = () => {}
  private onCloseCb: (err?: Error) => void = () => {}
  write(cmd: string) { this.written.push(cmd) }
  onData(cb: (l: string) => void) { this.onLine = cb }
  onClose(cb: (err?: Error) => void) { this.onCloseCb = cb }
  emit(line: string) { this.onLine(line) }
  triggerClose(err?: Error) { this.onCloseCb(err) }
  close() {}
}

test('analyze 发送 position+go 并按 multipv 聚合候选,bestmove 收尾', async () => {
  const ft = new FakeTransport()
  const eng = new UciEngine(ft)
  const p = eng.analyze('startpos_fen_here', { multipv: 2, movetime: 100 })

  ft.emit('info depth 8 multipv 1 score cp 20 pv b0c2 a9b7')
  ft.emit('info depth 8 multipv 2 score cp -10 pv h2e2 i9h7')
  ft.emit('info depth 12 multipv 1 score cp 25 pv b0c2 a9b7 c3c4')
  ft.emit('bestmove b0c2')

  const lines = await p
  expect(ft.written).toContain('setoption name MultiPV value 2')
  expect(ft.written).toContain('position fen startpos_fen_here')
  expect(ft.written).toContain('go movetime 100')
  expect(lines).toHaveLength(2)
  expect(lines.find(l => l.multipv === 1)!.scoreCp).toBe(25)
  expect(lines[0].multipv).toBe(1)
})

test('analyze 在超时内未收到 bestmove 则 reject(含 timeout)', async () => {
  vi.useFakeTimers()
  try {
    const ft = new FakeTransport()
    const eng = new UciEngine(ft, { timeoutMs: 1000 })
    const p = eng.analyze('fen', { multipv: 1, movetime: 100 })
    // 不喂任何 bestmove,推进时钟越过超时
    const expectation = expect(p).rejects.toThrow(/timeout/i)
    await vi.advanceTimersByTimeAsync(1500)
    await expectation
  } finally {
    vi.useRealTimers()
  }
})

test('transport 异常关闭时在途 analyze 被 reject(含 engine)', async () => {
  const ft = new FakeTransport()
  const eng = new UciEngine(ft)
  const p = eng.analyze('fen', { multipv: 1, movetime: 100 })
  const expectation = expect(p).rejects.toThrow(/engine/i)
  ft.triggerClose(new Error('process exited'))
  await expectation
})

test('并发 analyze 串行执行,各拿各自结果不串扰', async () => {
  const ft = new FakeTransport()
  const eng = new UciEngine(ft)
  const p1 = eng.analyze('fenA', { multipv: 1, movetime: 100 })
  const p2 = eng.analyze('fenB', { multipv: 1, movetime: 100 })

  // 队列:第一个先发 position fenA;喂第一组候选+bestmove 收尾
  expect(ft.written).toContain('position fen fenA')
  expect(ft.written).not.toContain('position fen fenB')
  ft.emit('info depth 8 multipv 1 score cp 11 pv aa11')
  ft.emit('bestmove aa11')
  const lines1 = await p1
  expect(lines1).toHaveLength(1)
  expect(lines1[0].scoreCp).toBe(11)

  // 第一个 settle 后队列才发第二个 position fenB
  expect(ft.written).toContain('position fen fenB')
  ft.emit('info depth 8 multipv 1 score cp 22 pv bb22')
  ft.emit('bestmove bb22')
  const lines2 = await p2
  expect(lines2).toHaveLength(1)
  expect(lines2[0].scoreCp).toBe(22)
})
