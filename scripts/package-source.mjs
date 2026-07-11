#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'

const dryRun = process.argv.includes('--dry-run')
const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim()
const shortHash = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
const archiveEnv = process.env.WEIGUAN_ARCHIVE
const output = archiveEnv
  ? (isAbsolute(archiveEnv) ? archiveEnv : join(root, archiveEnv))
  : join(root, 'dist', `weiguan-xiangqi-source-${shortHash}.zip`)

const tracked = execFileSync('git', ['ls-tree', '-r', '--name-only', 'HEAD'], { cwd: root, encoding: 'utf8' })
  .split('\n')
  .filter(Boolean)

function isEnvSecretPath(path) {
  const name = path.split('/').pop()
  return name === '.env' || (name?.startsWith('.env.') && name !== '.env.example')
}

const forbidden = tracked.filter(path =>
  isEnvSecretPath(path)
  || /\.sqlite(-wal|-shm)?$/.test(path)
  || path.startsWith('server/static/')
  || path.startsWith('server/dist/')
  || path.startsWith('web/dist/')
  || path.startsWith('node_modules/')
  || path.startsWith('server/engine/')
)

if (forbidden.length > 0) {
  console.error('Refusing to package tracked runtime/secret-like files:')
  for (const path of forbidden) console.error(`- ${path}`)
  process.exit(1)
}

const args = [
  'archive',
  '--format=zip',
  `--prefix=weiguan-xiangqi-${shortHash}/`,
  '-o',
  output,
  'HEAD',
]

if (dryRun) {
  console.log(`Would run: git ${args.join(' ')}`)
  console.log(`Tracked files checked: ${tracked.length}`)
  process.exit(0)
}

mkdirSync(dirname(output), { recursive: true })
execFileSync('git', args, { cwd: root, stdio: 'inherit' })
console.log(output)
