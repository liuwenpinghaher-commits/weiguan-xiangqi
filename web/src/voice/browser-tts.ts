import { voiceParam } from './voice-config.js'

// 浏览器 TTS。语音列表异步加载,挑一个中文嗓子;角色用音高/语速区分。
let zhVoice: SpeechSynthesisVoice | null = null
let muted = false

function pickZhVoice(): SpeechSynthesisVoice | null {
  if (typeof speechSynthesis === 'undefined') return null
  const voices = speechSynthesis.getVoices()
  return voices.find(v => v.lang?.toLowerCase().startsWith('zh')) ?? null
}

// 语音列表可能首调用为空,监听 voiceschanged 补齐
if (typeof speechSynthesis !== 'undefined') {
  zhVoice = pickZhVoice()
  speechSynthesis.onvoiceschanged = () => { zhVoice = pickZhVoice() }
}

export function isTtsSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

export function setMuted(m: boolean): void {
  muted = m
  if (m && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

export function isMuted(): boolean { return muted }

/** 念一句;静音或不支持时静默跳过。多句自动排队(SpeechSynthesis 内部队列)。 */
export function speak(personaId: string, text: string): void {
  if (muted || !isTtsSupported() || !text) return
  const u = new SpeechSynthesisUtterance(text)
  const { pitch, rate } = voiceParam(personaId)
  u.lang = 'zh-CN'
  u.pitch = pitch
  u.rate = rate
  if (!zhVoice) zhVoice = pickZhVoice()
  if (zhVoice) u.voice = zhVoice
  speechSynthesis.speak(u)
}

/** 立刻停掉当前与排队的播报(如重开一局) */
export function cancelSpeech(): void {
  if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}
