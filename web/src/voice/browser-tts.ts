import { voiceParam } from './voice-config.js'

// 浏览器 TTS。语音列表异步加载,挑一个中文嗓子;角色用音高/语速区分。
let zhVoice: SpeechSynthesisVoice | null = null

// 静音状态 — 从 localStorage 恢复初值,保证刷新后持久化
const MUTED_KEY = 'weiguan_muted'
let muted: boolean = (() => {
  try { return localStorage.getItem(MUTED_KEY) === 'true' } catch { return false }
})()

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

/** 判断当前是否有可用的中文语音嗓子 */
export function hasZhVoice(): boolean {
  if (!isTtsSupported()) return false
  if (!zhVoice) zhVoice = pickZhVoice()
  return zhVoice !== null
}

export function setMuted(m: boolean): void {
  muted = m
  try { localStorage.setItem(MUTED_KEY, String(m)) } catch { /* 隐私模式下忽略 */ }
  if (m && typeof speechSynthesis !== 'undefined') speechSynthesis.cancel()
}

export function isMuted(): boolean { return muted }

/**
 * 自有排队计数器。
 * 策略：每次 speak 调用检查排队深度；若已有 >2 条在等待则先 cancel() 清空，
 * 只保留最新一条。目的：群聊高张力时语音不严重滞后。
 */
let pendingCount = 0

/** 念一句;静音或不支持时静默跳过。 */
export function speak(personaId: string, text: string, opts?: { mustKeep?: boolean }): void {
  if (muted || !isTtsSupported() || !text) return

  // 队列过深 — 丢弃积压，只念最新（防止语音严重滞后）
  if (pendingCount > 2 && !opts?.mustKeep) {
    speechSynthesis.cancel()
    pendingCount = 0
  }

  const u = new SpeechSynthesisUtterance(text)
  const { pitch, rate } = voiceParam(personaId)
  u.lang = 'zh-CN'
  u.pitch = pitch
  u.rate = rate
  if (!zhVoice) zhVoice = pickZhVoice()
  if (zhVoice) u.voice = zhVoice

  pendingCount++
  u.onend = () => { pendingCount = Math.max(0, pendingCount - 1) }
  u.onerror = () => { pendingCount = Math.max(0, pendingCount - 1) }

  speechSynthesis.speak(u)
}

/** 立刻停掉当前与排队的播报(如重开一局) */
export function cancelSpeech(): void {
  if (typeof speechSynthesis !== 'undefined') {
    speechSynthesis.cancel()
    pendingCount = 0
  }
}
