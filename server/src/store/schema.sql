CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  mode TEXT NOT NULL,
  human_side TEXT NOT NULL,
  result TEXT,
  start_fen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL,
  side TEXT NOT NULL,
  move TEXT NOT NULL,
  fen_after TEXT NOT NULL,
  score_cp INTEGER,
  by_ai INTEGER NOT NULL DEFAULT 0,
  UNIQUE(game_id, ply)
);

CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id, ply);

-- 逐手诊断标注(局后分析产出)
CREATE TABLE IF NOT EXISTS move_annotations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL,
  side TEXT NOT NULL,
  cp_loss INTEGER NOT NULL,
  best_move TEXT NOT NULL,
  phase TEXT NOT NULL,
  theme TEXT NOT NULL,
  UNIQUE (game_id, ply)
);
CREATE INDEX IF NOT EXISTS idx_annot_game ON move_annotations(game_id, ply);

-- 逐局成长指标快照(成长曲线 / 历史对比的数据点)
CREATE TABLE IF NOT EXISTS growth_metrics (
  game_id INTEGER PRIMARY KEY REFERENCES games(id),
  analyzed_at TEXT NOT NULL,
  human_side TEXT NOT NULL,
  acpl INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  est_elo INTEGER NOT NULL,
  opening_acpl INTEGER NOT NULL,
  midgame_acpl INTEGER NOT NULL,
  endgame_acpl INTEGER NOT NULL,
  blunders INTEGER NOT NULL,
  mistakes INTEGER NOT NULL,
  result TEXT
);
