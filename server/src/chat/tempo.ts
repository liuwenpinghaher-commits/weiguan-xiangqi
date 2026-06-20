export interface TempoOpts { minSilenceMs: number; maxPerMin: number; now: () => number }

export class TempoGuard {
  private lastAt = -Infinity
  private window: number[] = []  // 最近发言时间戳
  constructor(private opts: TempoOpts) {}

  allow(): boolean {
    const t = this.opts.now()
    if (t - this.lastAt < this.opts.minSilenceMs) return false
    this.window = this.window.filter(ts => t - ts < 60_000)
    return this.window.length < this.opts.maxPerMin
  }

  record(): void {
    const t = this.opts.now()
    this.lastAt = t
    this.window.push(t)
  }
}
