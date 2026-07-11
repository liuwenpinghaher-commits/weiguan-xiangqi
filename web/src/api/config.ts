// 后端地址解析(端口约定:后端 3410 / 前端 3420):
//  1. 优先用构建期注入的 VITE_API_BASE(完整 URL,如 http://192.168.1.5:3410),便于显式 LAN/自定义部署;
//  2. 未配置时固定指向本机 localhost,不根据页面 hostname 暗示局域网已被服务端放行。
const ENV_BASE = (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE : undefined)?.trim() || undefined
const HOST = typeof window !== 'undefined' && window.location?.hostname
  ? window.location.hostname
  : 'localhost'

export function resolveApiBases(envBase?: string, _host = 'localhost'): { httpBase: string; wsBase: string } {
  const base = envBase?.trim() || undefined
  if (base) return { httpBase: base, wsBase: base.replace(/^http/i, 'ws') }
  return { httpBase: 'http://localhost:3410', wsBase: 'ws://localhost:3410' }
}

const BASES = resolveApiBases(ENV_BASE, HOST)
export const HTTP_BASE = BASES.httpBase
export const WS_BASE = BASES.wsBase

/** 服务端 ASR 接口(POST 音频二进制) */
export const ASR_URL = `${HTTP_BASE}/asr`
