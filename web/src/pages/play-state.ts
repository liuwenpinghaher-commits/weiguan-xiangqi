export type GameStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'paused' | 'over' | 'error'
export type HumanSide = 'red' | 'black'
export type DiagnosisStatus =
  | { status: 'pending' }
  | { status: 'running'; updatedAt?: string }
  | { status: 'ok'; updatedAt?: string }
  | { status: 'failed'; updatedAt?: string; error?: string }
export type EngineStatus =
  | { configured: true; degraded: boolean; reason: string | null }
  | { configured: false; degraded: true; reason: string | null }

export function shouldAcceptChat(currentGameId: number | null, messageGameId: number): boolean {
  return currentGameId !== null && currentGameId === messageGameId
}

export function nextStatusFromState(state: { over: boolean; paused?: boolean }): GameStatus {
  if (state.over) return 'over'
  if (state.paused) return 'paused'
  return 'playing'
}

export function shouldAwaitAiOnStarted(side: HumanSide): boolean {
  return side === 'black'
}

export function primaryActionKind(status: GameStatus): 'start' | 'restart' | 'pause' | 'resume' | 'disabled' {
  if (status === 'idle') return 'start'
  if (status === 'over' || status === 'error') return 'restart'
  if (status === 'playing') return 'pause'
  if (status === 'paused') return 'resume'
  return 'disabled'
}

export function postGameAnalysisHint(status?: DiagnosisStatus): string {
  if (status?.status === 'ok') return '已完成诊断，可查看分析或进行针对训练'
  if (status?.status === 'failed') return `自动诊断失败${status.error ? `：${status.error}` : ''}，可在分析页手动重试`
  if (status?.status === 'running') return '正在自动诊断，稍后可查看分析或进行针对训练'
  if (status?.status === 'pending') return '本局尚未完成诊断，可在分析页诊断后再训练'
  return '已触发局后诊断；若分析页暂无数据，可手动重试'
}

export function engineStatusHint(status: EngineStatus | null): string | null {
  if (!status) return null
  if (!status.configured) return `引擎不可用${status.reason ? `：${status.reason}` : ''}`
  if (status.degraded) return `引擎异常${status.reason ? `：${status.reason}` : ''}，可稍后重试`
  return null
}
