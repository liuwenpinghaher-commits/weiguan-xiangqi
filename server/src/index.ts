import { buildServer } from './ws-server.js'

const enginePath = process.env.PIKAFISH_PATH
if (!enginePath) {
  console.error('请设置 PIKAFISH_PATH 指向 Pikafish 可执行文件')
  process.exit(1)
}

const app = await buildServer({ dbPath: process.env.DB_PATH ?? './weiguan.sqlite', enginePath })
await app.listen({ port: 8787 })
console.log('server on ws://localhost:8787/play')
