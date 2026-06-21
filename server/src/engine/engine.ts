import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname } from 'node:path'
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
// 队列上限:防诊断(可达 200 手逐手分析)瞬间塞满队列,拖垮正在进行的对弈。
// 超过则直接 reject,让上层降级而非无限堆积。
const QUEUE_MAX = 64

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
    if (this.queue.length >= QUEUE_MAX) {
      return Promise.reject(new Error(`引擎队列过载(queue overload，已达上限 ${QUEUE_MAX})`))
    }
    return new Promise<EngineLine[]>((resolve, reject) => {
      this.queue.push({ fen, opts, resolve, reject })
      this.dequeue()
    })
  }

  close() { this.transport.close() }
}

export function spawnTransport(binPath: string): Transport {
  // Pikafish 默认 EvalFile=pikafish.nnue，在进程 cwd 查找；把 cwd 设为二进制所在
  // 目录，使其自动找到同目录的权重文件。
  // ponytail: 假定 nnue 与二进制同目录；若分离再加 setoption EvalFile 显式配置
  const proc: ChildProcessWithoutNullStreams = spawn(binPath, [], { stdio: 'pipe', cwd: dirname(binPath) })
  const rl = createInterface({ input: proc.stdout })
  let onLine: (l: string) => void = () => {}
  let onClose: (err?: Error) => void = () => {}
  let closed = false
  const fireClose = (err?: Error) => { if (closed) return; closed = true; onClose(err) }
  rl.on('line', (l) => onLine(l))
  // 监听 stderr:引擎(权重缺失/非法 UCI 等)的诊断信息此前被丢弃,排障无从下手。
  proc.stderr?.on('data', (d) => console.warn('[engine stderr]', String(d).trim()))
  proc.on('error', (err) => fireClose(err))
  proc.on('exit', (code, signal) => {
    fireClose(code === 0 ? undefined : new Error(`engine exited code=${code} signal=${signal}`))
  })
  // 进程退出后再 write 会抛 EPIPE/ERR_STREAM_DESTROYED;包 try/catch 防其逸出拖垮 worker。
  const safeWrite = (s: string): void => {
    if (proc.killed || closed) return
    try { proc.stdin.write(s) } catch (err) { console.warn('[engine] stdin.write 失败(进程已退出?):', (err as Error).message) }
  }
  safeWrite('uci\n')
  safeWrite('isready\n')
  return {
    write: (cmd) => safeWrite(cmd + '\n'),
    onData: (cb) => { onLine = cb },
    onClose: (cb) => { onClose = cb },
    close: () => { safeWrite('quit\n'); proc.kill() },
  }
}
