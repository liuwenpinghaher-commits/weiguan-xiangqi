import type { DB } from './db.js'

export interface DrillAttemptInput {
  gameId: number
  ply: number
  chosenMove: string
  correct: boolean
  createdAt: string
}

export interface DrillStats {
  total: number
  correct: number
}

export class TrainingRepo {
  constructor(private db: DB) {}

  /** 插入一条作答记录，返回新行的 id */
  addDrillAttempt(input: DrillAttemptInput): number {
    const info = this.db.prepare(
      `INSERT INTO drill_attempts (game_id, ply, chosen_move, correct, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).run(input.gameId, input.ply, input.chosenMove, input.correct ? 1 : 0, input.createdAt)
    return Number(info.lastInsertRowid)
  }

  /** 单局训练进度:该局所有作答的总数和答对数 */
  drillStats(gameId: number): DrillStats {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct
       FROM drill_attempts WHERE game_id = ?`
    ).get(gameId) as any
    return { total: row.total as number, correct: row.correct as number }
  }

  /** 全局训练进度:所有局所有作答汇总 */
  drillStatsAll(): DrillStats {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total, COALESCE(SUM(correct), 0) AS correct
       FROM drill_attempts`
    ).get() as any
    return { total: row.total as number, correct: row.correct as number }
  }
}
