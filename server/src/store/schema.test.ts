import { test, expect } from 'vitest'
import { openDb } from './db.js'

test('openDb 建出 move_annotations 与 growth_metrics 表', () => {
  const db = openDb(':memory:')
  const names = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('move_annotations','growth_metrics')"
  ).all() as { name: string }[]).map((r) => r.name).sort()
  expect(names).toEqual(['growth_metrics', 'move_annotations'])
  db.close()
})

test('move_annotations 对同一 (game_id, ply) 唯一', () => {
  const db = openDb(':memory:')
  db.prepare('INSERT INTO games (started_at, mode, human_side, start_fen) VALUES (?,?,?,?)')
    .run('t', 'coach', 'red', 'FEN')
  const ins = db.prepare(
    'INSERT INTO move_annotations (game_id, ply, side, cp_loss, best_move, phase, theme) VALUES (?,?,?,?,?,?,?)'
  )
  ins.run(1, 1, 'red', 0, 'h2e2', 'opening', 'ok')
  expect(() => ins.run(1, 1, 'red', 5, 'b2e2', 'opening', 'ok')).toThrow()
  db.close()
})
