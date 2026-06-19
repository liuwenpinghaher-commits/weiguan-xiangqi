import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseInfoLine, parseBestmove } from './uci-parse.js'
import type { EngineLine } from '../types.js'

export interface Transport {
  write(cmd: string): void
  onData(cb: (line: string) => void): void
  /** 进程异常退出/出错时通知;err 存在表示出错 */
  onClose?(cb: (err?: Error) => void): void
  close(): void
}

export interface AnalyzeOpts { multipv: number; movetime?: number; depth?: number }

export interface UciEngineOpts {
  /** 等待 bestmove 的超时时间(ms);默认按 movetime/depth 推算 + 2000ms 缓冲 */
  timeoutMs?: number
}

/** 队列中一个待执行的 analyze 任务 */
interface PendingJob {
  fen: string
  opts: AnalyzeOpts
  resolve: (lines: EngineLine[]) => void
  reject: (err: Error) => void
}

const DEPTH_DEFAULT_MOVETIME = 5000
const TIMEOUT_BUFFER_MS = 2000

export class UciEngine {
  private latest = new Map<number, EngineLine>()
  private queue: PendingJob[] = []
  private active: PendingJob | null = null
  private timer: ReturnType<typeof setTimeout> | null = null

  constructor(private transport: Transport, private engineOpts: UciEngineOpts = {}) {
    this.transport.onData((line) => this.handle(line))
    this.transport.onClose?.((err) => this.onTransportClose(err))
  }

  private handle(line: string) {
    if (!this.active) return
    const info = parseInfoLine(line)
    if (info) { this.latest.set(info.multipv, info); return }
    if (parseBestmove(line) !== null || line.startsWith('bestmove')) {
      const lines = [...this.latest.values()].sort((a, b) => a.multipv - b.multipv)
      const job = this.active
      this.settle()
      job.resolve(lines)
      this.dequeue()
    }
  }

  private onTransportClose(err?: Error) {
    const e = new Error(`engine process closed${err ? `: ${err.message}` : ''}`)
    const pending = [...(this.active ? [this.active] : []), ...this.queue]
    this.active = null
    this.queue = []
    this.clearTimer()
    for (const job of pending) job.reject(e)
  }

  private clearTimer() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null }
  }

  /** 清理当前活动任务相关状态(不动队列) */
  private settle() {
    this.clearTimer()
    this.active = null
  }

  private timeoutFor(opts: AnalyzeOpts): number {
    if (this.engineOpts.timeoutMs != null) return this.engineOpts.timeoutMs
    const base = opts.movetime != null ? opts.movetime
      : opts.depth != null ? DEPTH_DEFAULT_MOVETIME : 500
    return base + TIMEOUT_BUFFER_MS
  }

  private dequeue() {
    if (this.active || this.queue.length === 0) return
    const job = this.queue.shift()!
    this.active = job
    this.latest.clear()
    this.transport.write(`setoption name MultiPV value ${job.opts.multipv}`)
    this.transport.write(`position fen ${job.fen}`)
    const go = job.opts.movetime != null ? `go movetime ${job.opts.movetime}`
      : job.opts.depth != null ? `go depth ${job.opts.depth}` : 'go movetime 500'
    this.timer = setTimeout(() => {
      const cur = this.active
      this.settle()
      cur?.reject(new Error(`engine analyze timeout after ${this.timeoutFor(job.opts)}ms`))
      this.dequeue()
    }, this.timeoutFor(job.opts))
    this.transport.write(go)
  }

  analyze(fen: string, opts: AnalyzeOpts): Promise<EngineLine[]> {
    return new Promise<EngineLine[]>((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject })
      this.dequeue()
    })
  }

  close() { this.transport.close() }
}

export function spawnTransport(binPath: string): Transport {
  const proc: ChildProcessWithoutNullStreams = spawn(binPath, [], { stdio: 'pipe' })
  const rl = createInterface({ input: proc.stdout })
  let onLine: (l: string) => void = () => {}
  let onClose: (err?: Error) => void = () => {}
  let closed = false
  const fireClose = (err?: Error) => { if (closed) return; closed = true; onClose(err) }
  rl.on('line', (l) => onLine(l))
  proc.on('error', (err) => fireClose(err))
  proc.on('exit', (code, signal) => {
    fireClose(code === 0 ? undefined : new Error(`engine exited code=${code} signal=${signal}`))
  })
  proc.stdin.write('uci\n')
  proc.stdin.write('isready\n')
  return {
    write: (cmd) => proc.stdin.write(cmd + '\n'),
    onData: (cb) => { onLine = cb },
    onClose: (cb) => { onClose = cb },
    close: () => { proc.stdin.write('quit\n'); proc.kill() },
  }
}
