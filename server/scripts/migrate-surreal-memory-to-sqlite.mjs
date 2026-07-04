#!/usr/bin/env node
/**
 * 一次性迁移:把旧 SurrealDB(weiguan 库)里的 fact/insight 记忆(含 1024 维向量)
 * 搬进 SQLite 的 memory 表。episode 是纯写入空转,不迁。向量直接整搬(维度一致,不重嵌入)。
 *
 * 幂等:按 (persona_id, kind, content, created_at) 去重,重复运行不会翻倍。
 * 前置:Surreal 正在 127.0.0.1:8000 跑(surrealkv://~/.surrealdb/data/weiguan.db)。
 * 用法:node server/scripts/migrate-surreal-memory-to-sqlite.mjs [目标.sqlite]
 *   目标缺省 server/weiguan.sqlite。
 */
import Database from 'better-sqlite3'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const dbPath = process.argv[2] ?? join(here, '..', 'weiguan.sqlite')
const SURREAL = 'http://127.0.0.1:8000/sql'
const auth = 'Basic ' + Buffer.from('root:root').toString('base64')

async function surrealQuery(sql) {
  const r = await fetch(SURREAL, {
    method: 'POST',
    headers: { authorization: auth, 'Surreal-NS': 'weiguan', 'Surreal-DB': 'weiguan', accept: 'application/json' },
    body: sql,
  })
  if (!r.ok) throw new Error(`Surreal HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const j = await r.json()
  const first = Array.isArray(j) ? j[0] : j
  if (first?.status && first.status !== 'OK') throw new Error(`Surreal 查询失败: ${JSON.stringify(first).slice(0, 200)}`)
  return first?.result ?? []
}

const db = new Database(dbPath)
// 确保 memory 表存在(与 schema.sql 一致;独立运行脚本时兜底建表)
db.exec(`CREATE TABLE IF NOT EXISTS memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT, persona_id TEXT NOT NULL, kind TEXT NOT NULL,
  content TEXT NOT NULL, importance INTEGER NOT NULL, game_id INTEGER,
  created_at TEXT NOT NULL, superseded_at TEXT, embedding TEXT);`)

console.log(`目标 SQLite: ${dbPath}`)
const rows = await surrealQuery(
  "SELECT persona_id, kind, content, importance, game_id, created_at, superseded_at, embedding FROM memory WHERE kind IN ['fact','insight'];"
)
console.log(`Surreal 中 fact/insight: ${rows.length} 条`)

const exists = db.prepare('SELECT 1 FROM memory WHERE persona_id=? AND kind=? AND content=? AND created_at=? LIMIT 1')
const insert = db.prepare(
  'INSERT INTO memory (persona_id, kind, content, importance, game_id, created_at, superseded_at, embedding) VALUES (?,?,?,?,?,?,?,?)'
)

let migrated = 0, skipped = 0, noVec = 0
const tx = db.transaction(() => {
  for (const r of rows) {
    if (exists.get(r.persona_id, r.kind, r.content, r.created_at)) { skipped++; continue }
    const emb = Array.isArray(r.embedding) && r.embedding.length ? JSON.stringify(r.embedding) : null
    if (!emb) noVec++
    insert.run(r.persona_id, r.kind, r.content, r.importance, r.game_id ?? null, r.created_at, r.superseded_at ?? null, emb)
    migrated++
  }
})
tx()

const total = db.prepare("SELECT count(*) AS n FROM memory WHERE kind IN ('fact','insight')").get().n
console.log(`迁移完成:新增 ${migrated}(其中无向量 ${noVec})、跳过已存在 ${skipped};SQLite 现有 fact/insight 共 ${total} 条`)
db.close()
