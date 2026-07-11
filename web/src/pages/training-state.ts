export interface TrainingDrillLike {
  bestMove: string
  playedMove: string
}

export function trainingAnswerFeedback(drill: TrainingDrillLike, move: string, saved: boolean): string {
  const base = move === drill.bestMove
    ? `✓ 正解！就是这手 ${move}。`
    : `✗ 你走了 ${move}；引擎最佳是 ${drill.bestMove}（原局你当时走的是 ${drill.playedMove}）`
  return saved ? base : `${base}（本地判题，训练进度未保存）`
}

export function trainingBoardDisabled(answering: boolean, feedback: string): boolean {
  return answering || feedback.trim() !== ''
}
