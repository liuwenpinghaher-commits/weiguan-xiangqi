import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export type DB = Database.Database

export function openDb(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8')
  db.exec(schema)
  return db
}
