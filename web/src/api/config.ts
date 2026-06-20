// 端口约定(固定):后端 3410 / 前端 3420。前端要改后端地址,只动这一处。
export const API_HOST = 'localhost:3410'
export const HTTP_BASE = `http://${API_HOST}`
export const WS_BASE = `ws://${API_HOST}`

/** 云端 TTS 接口 URL */
export function ttsUrl(personaId: string, text: string): string {
  return `${HTTP_BASE}/tts?personaId=${encodeURIComponent(personaId)}&text=${encodeURIComponent(text)}`
}
