// Vite 客户端环境变量类型声明。tsconfig 的 "types": [] 会排除 vite/client,
// 故在此手动声明本项目用到的 import.meta.env 字段(仅 VITE_ 前缀会被 Vite 注入到客户端)。
interface ImportMetaEnv {
  /** 可选:显式指定后端 API 基址(完整 URL,如 http://192.168.1.5:3410)。留空则按访问页面 hostname 拼 3410。 */
  readonly VITE_API_BASE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
