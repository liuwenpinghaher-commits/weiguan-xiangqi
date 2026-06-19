import { test, expect } from 'vitest'
import { UciEngine, type Transport } from './engine.js'

/** 测试替身:记录写入的命令,可手动推送引擎输出行 */
class FakeTransport implements Transport {
  written: string[] = []
  private onLine: (l: string) => void = () => {}
  write(cmd: string) { this.written.push(cmd) }
  onData(cb: (l: string) => void) { this.onLine = cb }
  emit(line: string) { this.onLine(line) }
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
