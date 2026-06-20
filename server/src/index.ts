import { buildServer } from './ws-server.js'

const enginePath = process.env.PIKAFISH_PATH
if (!enginePath) {
  console.error('请设置 PIKAFISH_PATH 指向 Pikafish 可执行文件')
  process.exit(1)
}

const app = await buildServer({ dbPath: process.env.DB_PATH ?? './weiguan.sqlite', enginePath })
// 固定端口约定:后端 3410(可用 PORT 覆盖)。前端 3420(见 web/vite.config.ts)。
const port = Number(process.env.PORT ?? 3410)
await app.listen({ port, host: '127.0.0.1' })
console.log(`server on ws://localhost:${port}/play`)
