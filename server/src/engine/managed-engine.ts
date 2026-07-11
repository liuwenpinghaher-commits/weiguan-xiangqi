import type { EngineLine } from '../types.js'
import type { AnalyzeOpts } from './engine.js'

export interface ManagedEngineInner {
  analyze(fen: string, opts: AnalyzeOpts): Promise<EngineLine[]>
  close?(): void
}

export interface EngineStatus {
  configured: true
  degraded: boolean
  reason: string | null
}

export class ManagedEngine {
  private inner: ManagedEngineInner | null = null
  private degradedReason: string | null = null
  private closed = false

  constructor(private factory: () => ManagedEngineInner) {}

  status(): EngineStatus {
    return { configured: true, degraded: this.degradedReason !== null, reason: this.degradedReason }
  }

  async analyze(fen: string, opts: AnalyzeOpts): Promise<EngineLine[]> {
    try {
      const result = await this.current().analyze(fen, opts)
      this.degradedReason = null
      return result
    } catch (err) {
      this.markDegraded(err)
      this.resetInner()
    }

    try {
      const result = await this.current().analyze(fen, opts)
      this.degradedReason = null
      return result
    } catch (err) {
      this.markDegraded(err)
      this.resetInner()
      throw err
    }
  }

  close(): void {
    this.closed = true
    this.resetInner()
  }

  private current(): ManagedEngineInner {
    if (this.closed) throw new Error('engine manager closed')
    if (!this.inner) this.inner = this.factory()
    return this.inner
  }

  private resetInner(): void {
    try { this.inner?.close?.() } catch {}
    this.inner = null
  }

  private markDegraded(err: unknown): void {
    this.degradedReason = err instanceof Error ? err.message : String(err)
  }
}
