// 后端地址解析(端口约定:后端 3410 / 前端 3420):
//  1. 优先用构建期注入的 VITE_API_BASE(完整 URL,如 http://192.168.1.5:3410),便于自定义部署;
//  2. 否则按"当前访问页面的 hostname"拼 3410 —— 手机/局域网用 http://<局域网IP>:3420 打开前端时,
//     后端也自动指向同一台机的 3410,不再写死 localhost 导致外部设备访问失败;
//  3. 无 window(SSR/测试)时退回 localhost。
const ENV_BASE = (typeof import.meta !== 'undefined' ? import.meta.env?.VITE_API_BASE : undefined)?.trim() || undefined
const HOST = typeof window !== 'undefined' && window.location?.hostname
  ? window.location.hostname
  : 'localhost'
export const HTTP_BASE = ENV_BASE ?? `http://${HOST}:3410`
// WS 基址:显式 base 时把 http(s) 前缀换成 ws(s),否则按同一 hostname 拼 ws://…:3410
export const WS_BASE = ENV_BASE ? ENV_BASE.replace(/^http/i, 'ws') : `ws://${HOST}:3410`

/** TTS 接口 URL(后端 /tts → qwen3-tts-flash 云合成) */
export function ttsUrl(personaId: string, text: string): string {
  return `${HTTP_BASE}/tts?personaId=${encodeURIComponent(personaId)}&text=${encodeURIComponent(text)}`
}

/** 服务端 ASR 接口(POST 音频二进制) */
export const ASR_URL = `${HTTP_BASE}/asr`
