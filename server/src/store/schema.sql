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

-- 角色长期记忆(语义 + recency 检索)。原用 SurrealDB(HNSW 向量),因实际数据量极小
-- (每角色十来条 fact/insight),改回 SQLite:向量存 JSON,检索时在 JS 里暴力算余弦——毫秒级,
-- 且去掉独立进程依赖与"没起 Surreal 就静默变不持久"的坑。见 SqliteMemoryStore。
CREATE TABLE IF NOT EXISTS memory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,              -- episode | fact | insight
  content       TEXT NOT NULL,
  importance    INTEGER NOT NULL,
  game_id       INTEGER,                    -- 关联对局(可空);删局级联清理
  created_at    TEXT NOT NULL,
  superseded_at TEXT,                       -- 被 judge 作废的时间(NULL=有效)
  embedding     TEXT                        -- 向量 JSON(number[]);NULL=无向量(episode 或嵌入失败)
);
CREATE INDEX IF NOT EXISTS idx_memory_persona_kind ON memory(persona_id, kind, superseded_at);
CREATE INDEX IF NOT EXISTS idx_memory_game ON memory(game_id);

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

CREATE TABLE IF NOT EXISTS app_settings (
  section    TEXT PRIMARY KEY,
  json       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS persona_config (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  is_player   INTEGER NOT NULL,
  skill       TEXT NOT NULL,
  background  TEXT NOT NULL,
  voice_style TEXT NOT NULL,
  leaning     TEXT NOT NULL,
  tts_voice   TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  updated_at  TEXT NOT NULL
);

-- 热路径索引:recentResults(每步 buildContext 必调)与 weaknessProfile 原为全表扫
CREATE INDEX IF NOT EXISTS idx_games_result_ended ON games(result, ended_at);
CREATE INDEX IF NOT EXISTS idx_annotations_side_theme ON move_annotations(side, theme);
