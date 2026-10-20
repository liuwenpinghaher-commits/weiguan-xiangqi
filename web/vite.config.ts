import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// 端口约定:默认前端 3420(可用 VITE_PORT 覆盖;后端默认 3410,见 server/src/index.ts)
const port = Number(process.env.VITE_PORT ?? 3420)
export default defineConfig({ plugins: [react()], server: { port, strictPort: true } })
