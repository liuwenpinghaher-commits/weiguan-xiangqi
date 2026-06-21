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

// 优雅关闭:SIGINT(Ctrl-C)与 SIGTERM(systemd/Docker)均触发 app.close()
// app.close() 会依次执行 onClose hooks(engine.close + db.close),等 WAL checkpoint 完成后退出
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    app.close().then(() => process.exit(0)).catch(() => process.exit(1))
  })
}

// 进程级兜底:未捕获异常/未处理 rejection 一律记日志并退出(让 supervisor 重启),
// 避免进入"半死"状态(事件循环还在但状态已损坏)继续服务脏请求。
process.on('unhandledRejection', (r) => {
  console.error('[fatal] unhandledRejection', r)
  process.exit(1)
})
process.on('uncaughtException', (e) => {
  console.error('[fatal] uncaughtException', e)
  process.exit(1)
})
