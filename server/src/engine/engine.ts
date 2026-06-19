import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { parseInfoLine, parseBestmove } from './uci-parse.js'
import type { EngineLine } from '../types.js'

export interface Transport {
  write(cmd: string): void
  onData(cb: (line: string) => void): void
  close(): void
}

export interface AnalyzeOpts { multipv: number; movetime?: number; depth?: number }

export class UciEngine {
  private latest = new Map<number, EngineLine>()
  private resolveFn: ((lines: EngineLine[]) => void) | null = null

  constructor(private transport: Transport) {
    this.transport.onData((line) => this.handle(line))
  }

  private handle(line: string) {
    const info = parseInfoLine(line)
    if (info) { this.latest.set(info.multipv, info); return }
    if (parseBestmove(line) !== null || line.startsWith('bestmove')) {
      const lines = [...this.latest.values()].sort((a, b) => a.multipv - b.multipv)
      this.resolveFn?.(lines)
      this.resolveFn = null
    }
  }

  analyze(fen: string, opts: AnalyzeOpts): Promise<EngineLine[]> {
    this.latest.clear()
    this.transport.write(`setoption name MultiPV value ${opts.multipv}`)
    this.transport.write(`position fen ${fen}`)
    const go = opts.movetime != null ? `go movetime ${opts.movetime}`
      : opts.depth != null ? `go depth ${opts.depth}` : 'go movetime 500'
    return new Promise((resolve) => {
      this.resolveFn = resolve
      this.transport.write(go)
    })
  }

  close() { this.transport.close() }
}

export function spawnTransport(binPath: string): Transport {
  const proc: ChildProcessWithoutNullStreams = spawn(binPath, [], { stdio: 'pipe' })
  const rl = createInterface({ input: proc.stdout })
  let onLine: (l: string) => void = () => {}
  rl.on('line', (l) => onLine(l))
  proc.stdin.write('uci\n')
  proc.stdin.write('isready\n')
  return {
    write: (cmd) => proc.stdin.write(cmd + '\n'),
    onData: (cb) => { onLine = cb },
    close: () => { proc.stdin.write('quit\n'); proc.kill() },
  }
}
