import { buildServer } from './ws-server.js'

const enginePath = process.env.PIKAFISH_PATH
if (!enginePath) {
  console.warn('未配置 PIKAFISH_PATH:对弈/诊断功能不可用,聊天与复盘仍可用')
}

const app = await buildServer({ dbPath: process.env.DB_PATH ?? './weiguan.sqlite', enginePath })
// 固定端口约定:后端 3410(可用 PORT 覆盖)。前端 3420(见 web/vite.config.ts)。
const port = Number(process.env.PORT ?? 3410)
await app.listen({ port, host: '127.0.0.1' })
console.log(`server on ws://localhost:${port}/play`)
