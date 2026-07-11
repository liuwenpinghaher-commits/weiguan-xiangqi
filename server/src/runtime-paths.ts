import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, isAbsolute, resolve } from 'node:path'

export function resolveDbPath(
  dbPath = process.env.DB_PATH,
  env: { cwd: string; home: string } = { cwd: process.cwd(), home: homedir() },
): string {
  if (!dbPath || dbPath.trim() === '') return resolve(env.home, '.weiguan-xiangqi', 'weiguan.sqlite')
  return isAbsolute(dbPath) ? dbPath : resolve(env.cwd, dbPath)
}

export function ensureDbParentDir(dbPath: string): void {
  mkdirSync(dirname(dbPath), { recursive: true })
}
