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

-- 角色长期记忆(跨会话):episode=互动片段, fact=抽取的事实, insight=反思洞见
CREATE TABLE IF NOT EXISTS persona_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- episode | fact | insight
  content TEXT NOT NULL,
  game_id INTEGER,                    -- 关联对局(可空)
  importance INTEGER NOT NULL DEFAULT 1,  -- 1..5
  created_at TEXT NOT NULL,
  heat REAL NOT NULL DEFAULT 1.0      -- 衰减热度(检索用)
);
CREATE INDEX IF NOT EXISTS idx_pmem_persona ON persona_memory(persona_id, created_at);

-- 训练作答记录(做题结果持久化)
CREATE TABLE IF NOT EXISTS drill_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  ply INTEGER NOT NULL,
  chosen_move TEXT NOT NULL,
  correct INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_drill_game ON drill_attempts(game_id);

-- 聊天/发言持久化:每条消息一行(角色发言 + 玩家发言)
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL,
  persona_id TEXT NOT NULL,      -- 角色 id;玩家发言用 'human'
  role TEXT NOT NULL,            -- 'persona' | 'human'
  text TEXT NOT NULL,
  addressee TEXT,
  ts TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_game ON messages(game_id, id);
