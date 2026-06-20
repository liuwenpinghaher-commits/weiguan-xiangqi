import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
// 固定端口约定:前端 3420(后端 3410,见 server/src/index.ts)
export default defineConfig({ plugins: [react()], server: { port: 3420, strictPort: true } })
