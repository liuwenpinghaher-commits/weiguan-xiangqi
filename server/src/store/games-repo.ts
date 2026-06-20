import type { DB } from './db.js'
import type { GameMode, Side } from '../types.js'

type RecentResult = 'win' | 'loss' | 'draw'

export interface GameRow {
  id: number; startedAt: string; endedAt: string | null
  mode: GameMode; humanSide: Side; result: Side | 'draw' | null; startFen: string
}
export interface MoveRow {
  id: number; gameId: number; ply: number; side: Side
  move: string; fenAfter: string; scoreCp: number | null; byAi: boolean
}

export class GamesRepo {
  constructor(private db: DB) {}

  createGame(g: { mode: GameMode; humanSide: Side; startFen: string; startedAt: string }): number {
    const info = this.db.prepare(
      'INSERT INTO games (started_at, mode, human_side, start_fen) VALUES (?,?,?,?)'
    ).run(g.startedAt, g.mode, g.humanSide, g.startFen)
    return Number(info.lastInsertRowid)
  }

  getGame(id: number): GameRow | null {
    const r: any = this.db.prepare('SELECT * FROM games WHERE id=?').get(id)
    if (!r) return null
    return { id: r.id, startedAt: r.started_at, endedAt: r.ended_at, mode: r.mode,
      humanSide: r.human_side, result: r.result, startFen: r.start_fen }
  }

  addMove(m: { gameId: number; side: Side; move: string; fenAfter: string; scoreCp: number | null; byAi: boolean }): number {
    const next: any = this.db.prepare('SELECT COALESCE(MAX(ply),0)+1 AS p FROM moves WHERE game_id=?').get(m.gameId)
    const info = this.db.prepare(
      'INSERT INTO moves (game_id, ply, side, move, fen_after, score_cp, by_ai) VALUES (?,?,?,?,?,?,?)'
    ).run(m.gameId, next.p, m.side, m.move, m.fenAfter, m.scoreCp, m.byAi ? 1 : 0)
    return Number(info.lastInsertRowid)
  }

  getMoves(gameId: number): MoveRow[] {
    const rows: any[] = this.db.prepare('SELECT * FROM moves WHERE game_id=? ORDER BY ply').all(gameId)
    return rows.map(r => ({ id: r.id, gameId: r.game_id, ply: r.ply, side: r.side,
      move: r.move, fenAfter: r.fen_after, scoreCp: r.score_cp, byAi: !!r.by_ai }))
  }

  finishGame(id: number, result: Side | 'draw', endedAt: string): void {
    this.db.prepare('UPDATE games SET result=?, ended_at=? WHERE id=?').run(result, endedAt, id)
  }

  /** 返回所有对局，按 id 升序（供全库导出） */
  listGames(): GameRow[] {
    const rows: any[] = this.db.prepare(
      'SELECT * FROM games ORDER BY id ASC'
    ).all()
    return rows.map(r => ({
      id: r.id, startedAt: r.started_at, endedAt: r.ended_at, mode: r.mode,
      humanSide: r.human_side, result: r.result, startFen: r.start_fen,
    }))
  }

  /** 级联删除一局及其全部关联行(无 FK ON DELETE,手动事务清理) */
  deleteGame(id: number): void {
    const tx = this.db.transaction((gid: number) => {
      for (const t of ['moves', 'messages', 'move_annotations', 'drill_attempts', 'growth_metrics']) {
        this.db.prepare(`DELETE FROM ${t} WHERE game_id=?`).run(gid)
      }
      this.db.prepare('DELETE FROM games WHERE id=?').run(gid)
    })
    tx(id)
  }

  /** 最近已结束对局,相对各局自己的 human_side 映射成 玩家 视角的胜负(最近在前) */
  recentResults(limit: number): RecentResult[] {
    const rows: any[] = this.db.prepare(
      `SELECT result, human_side FROM games
       WHERE result IS NOT NULL
       ORDER BY ended_at DESC, id DESC
       LIMIT ?`
    ).all(limit)
    return rows.map(r => {
      if (r.result === 'draw') return 'draw'
      if (r.result === r.human_side) return 'win'
      return 'loss'
    })
  }
}
