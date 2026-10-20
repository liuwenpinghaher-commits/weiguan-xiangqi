import { spawn } from 'node:child_process'
import { mkdtempSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const API_PORT = process.env.WEIGUAN_E2E_API_PORT ?? '18310'
const WEB_PORT = process.env.WEIGUAN_E2E_WEB_PORT ?? '18320'
const tmpDir = mkdtempSync(join(tmpdir(), 'weiguan-e2e-'))
const dbPath = join(tmpDir, 'e2e.sqlite')

let shuttingDown = false
const children = []

function cleanup() {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) {
    try {
      child.kill('SIGTERM')
    } catch {}
  }
  try {
    rmSync(tmpDir, { recursive: true, force: true })
  } catch {}
}

process.on('SIGINT', () => {
  cleanup()
  process.exit(0)
})
process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})
process.on('exit', cleanup)

async function waitForHttp(url, timeoutMs = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url)
      if (res.ok || res.status < 500) return
    } catch {}
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

const serverProc = spawn(
  process.execPath,
  ['--import', 'tsx', 'src/index.ts'],
  {
    cwd: join(ROOT, 'server'),
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: API_PORT,
      HOST: '127.0.0.1',
      DB_PATH: dbPath,
      FRONTEND_ORIGINS: `http://localhost:${WEB_PORT},http://127.0.0.1:${WEB_PORT}`,
      DASHSCOPE_API_KEY: '',
    },
  },
)
children.push(serverProc)

await waitForHttp(`http://127.0.0.1:${API_PORT}/engine/status`)

const viteBin = existsSync(join(ROOT, 'web', 'node_modules', '.bin', 'vite'))
  ? join(ROOT, 'web', 'node_modules', '.bin', 'vite')
  : join(ROOT, 'node_modules', '.bin', 'vite')

const webProc = spawn(
  viteBin,
  ['--host', '127.0.0.1', '--port', WEB_PORT, '--strictPort'],
  {
    cwd: join(ROOT, 'web'),
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_PORT: WEB_PORT,
      VITE_API_BASE: `http://127.0.0.1:${API_PORT}`,
    },
  },
)
children.push(webProc)

await waitForHttp(`http://127.0.0.1:${WEB_PORT}/`)
console.log(`[weiguan-e2e] Backend :${API_PORT} and Frontend :${WEB_PORT} ready`)

await new Promise(() => {})
