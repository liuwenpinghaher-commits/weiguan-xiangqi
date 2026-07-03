// 端口约定(固定):后端 3410 / 前端 3420。前端要改后端地址,只动这一处。
export const API_HOST = 'localhost:3410'
export const HTTP_BASE = `http://${API_HOST}`
export const WS_BASE = `ws://${API_HOST}`

/** 本地 TTS 接口 URL(后端 /tts → moss-tts-nano 合成) */
export function ttsUrl(personaId: string, text: string): string {
  return `${HTTP_BASE}/tts?personaId=${encodeURIComponent(personaId)}&text=${encodeURIComponent(text)}`
}

/** 服务端 ASR 接口(POST 音频二进制) */
export const ASR_URL = `${HTTP_BASE}/asr`
