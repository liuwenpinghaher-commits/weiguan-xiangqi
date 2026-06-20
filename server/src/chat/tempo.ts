export interface TempoLimits { minSilenceMs: number; maxPerMin: number }
export interface TempoOpts { limits: () => TempoLimits; now: () => number }

export class TempoGuard {
  private lastAt = -Infinity
  private window: number[] = []  // 最近发言时间戳
  private limits: () => TempoLimits
  private now: () => number
  constructor(opts: TempoOpts) {
    this.limits = opts.limits
    this.now = opts.now
  }

  allow(): boolean {
    const { minSilenceMs, maxPerMin } = this.limits()  // 每次调用动态读取,配置变更即时生效
    const t = this.now()
    if (t - this.lastAt < minSilenceMs) return false
    this.window = this.window.filter(ts => t - ts < 60_000)
    return this.window.length < maxPerMin
  }

  record(): void {
    const t = this.now()
    this.lastAt = t
    this.window.push(t)
  }
}
