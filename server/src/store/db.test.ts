import { test, expect } from 'vitest'
import { openDb } from './db.js'

test('openDb(:memory:) 建表成功,可查到 games 表', () => {
  const db = openDb(':memory:')
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='games'"
  ).get()
  expect(row).toBeTruthy()
  db.close()
})

test('openDb 启用外键约束(foreign_keys=ON)', () => {
  const db = openDb(':memory:')
  expect(db.pragma('foreign_keys', { simple: true })).toBe(1)
  db.close()
})
