import type { DB } from './db.js'
import type { MoveAnnotation, GrowthMetric, Side, Phase, Theme } from '../types.js'

export interface WeaknessRow { phase: Phase; theme: Theme; count: number; avgLoss: number }

export class AnalysisRepo {
  constructor(private db: DB) {}

  saveAnnotation(a: MoveAnnotation): void {
    this.db.prepare(
      `INSERT INTO move_annotations (game_id, ply, side, cp_loss, best_move, phase, theme)
       VALUES (@gameId,@ply,@side,@cpLoss,@bestMove,@phase,@theme)
       ON CONFLICT(game_id, ply) DO UPDATE SET
         side=excluded.side, cp_loss=excluded.cp_loss, best_move=excluded.best_move,
         phase=excluded.phase, theme=excluded.theme`
    ).run(a)
  }

  getAnnotations(gameId: number): MoveAnnotation[] {
    const rows = this.db.prepare('SELECT * FROM move_annotations WHERE game_id=? ORDER BY ply').all(gameId) as any[]
    return rows.map((r) => ({
      gameId: r.game_id, ply: r.ply, side: r.side, cpLoss: r.cp_loss,
      bestMove: r.best_move, phase: r.phase, theme: r.theme,
    }))
  }

  saveGrowthMetric(m: GrowthMetric): void {
    this.db.prepare(
      `INSERT INTO growth_metrics (game_id, analyzed_at, human_side, acpl, accuracy, est_elo,
         opening_acpl, midgame_acpl, endgame_acpl, blunders, mistakes, result)
       VALUES (@gameId,@analyzedAt,@humanSide,@acpl,@accuracy,@estElo,
         @openingAcpl,@midgameAcpl,@endgameAcpl,@blunders,@mistakes,@result)
       ON CONFLICT(game_id) DO UPDATE SET
         analyzed_at=excluded.analyzed_at, human_side=excluded.human_side, acpl=excluded.acpl,
         accuracy=excluded.accuracy, est_elo=excluded.est_elo, opening_acpl=excluded.opening_acpl,
         midgame_acpl=excluded.midgame_acpl, endgame_acpl=excluded.endgame_acpl,
         blunders=excluded.blunders, mistakes=excluded.mistakes, result=excluded.result`
    ).run(m)
  }

  getGrowthMetric(gameId: number): GrowthMetric | null {
    const r = this.db.prepare('SELECT * FROM growth_metrics WHERE game_id=?').get(gameId) as any
    return r ? mapGrowth(r) : null
  }

  listGrowthMetrics(): GrowthMetric[] {
    const rows = this.db.prepare('SELECT * FROM growth_metrics ORDER BY analyzed_at, game_id').all() as any[]
    return rows.map(mapGrowth)
  }

  /** 弱点画像:某方所有非 ok 标注,按 phase×theme 聚合,降序排列 */
  weaknessProfile(humanSide: Side): WeaknessRow[] {
    const rows = this.db.prepare(
      `SELECT phase, theme, COUNT(*) AS count, CAST(ROUND(AVG(cp_loss)) AS INTEGER) AS avgLoss
       FROM move_annotations WHERE side=? AND theme!='ok'
       GROUP BY phase, theme ORDER BY count DESC, avgLoss DESC`
    ).all(humanSide) as any[]
    return rows.map((r) => ({ phase: r.phase, theme: r.theme, count: r.count, avgLoss: r.avgLoss }))
  }
}

function mapGrowth(r: any): GrowthMetric {
  return {
    gameId: r.game_id, analyzedAt: r.analyzed_at, humanSide: r.human_side, acpl: r.acpl,
    accuracy: r.accuracy, estElo: r.est_elo, openingAcpl: r.opening_acpl, midgameAcpl: r.midgame_acpl,
    endgameAcpl: r.endgame_acpl, blunders: r.blunders, mistakes: r.mistakes, result: r.result,
  }
}
