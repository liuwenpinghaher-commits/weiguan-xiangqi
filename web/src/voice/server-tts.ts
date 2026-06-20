import { ttsUrl } from '../api/config.js'
import { isMuted, speak as browserSpeak } from './browser-tts.js'

/**
 * 云端 CosyVoice 语音播放。
 *
 * 关键点:浏览器自动播放策略要求音频在「用户手势」后才能 play()。
 * 由于弹幕的 play() 发生在 await fetch 之后(脱离手势调用栈),
 * 直接 new Audio().play() 会被拒(Safari 尤其严)。
 * 解决:复用**单个** <audio> 元素,并在首次用户手势(点击/键盘/走子)
 * 时用一段静音 WAV 解锁该元素;解锁后所有云端音频都能正常播放。
 */

type QueueItem = { personaId: string; text: string }

let queue: QueueItem[] = []
let playing = false
let unlocked = false
let audioEl: HTMLAudioElement | null = null

/** 生成一段极短静音 WAV 的 data URI,用于在用户手势内解锁音频元素。 */
function silentWav(): string {
  const sampleRate = 8000
  const numSamples = 80 // ~10ms
  const dataSize = numSamples // 8-bit 单声道,每样本 1 字节
  const buf = new ArrayBuffer(44 + dataSize)
  const v = new DataView(buf)
  const w = (off: number, s: string) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)) }
  w(0, 'RIFF'); v.setUint32(4, 36 + dataSize, true); w(8, 'WAVE'); w(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate, true)
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); w(36, 'data'); v.setUint32(40, dataSize, true)
  for (let i = 0; i < numSamples; i++) v.setUint8(44 + i, 128) // 8-bit 静音中点
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i])
  return 'data:audio/wav;base64,' + btoa(bin)
}

function getAudio(): HTMLAudioElement {
  if (!audioEl) audioEl = new Audio()
  return audioEl
}

/** 在用户手势内调用:播放静音以解锁音频元素,之后可程序化播放。 */
function tryUnlock(): void {
  if (unlocked) return
  const a = getAudio()
  a.src = silentWav()
  const p = a.play()
  if (p && typeof p.then === 'function') {
    p.then(() => { unlocked = true; void playNext() }).catch(() => { /* 仍未解锁,等下次手势 */ })
  } else {
    unlocked = true
    void playNext()
  }
}

// 任意用户手势都尝试解锁(用户走子/点按钮即触发);幂等。
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', tryUnlock)
  window.addEventListener('keydown', tryUnlock)
  window.addEventListener('touchstart', tryUnlock)
}

async function playNext(): Promise<void> {
  if (playing || queue.length === 0) return
  // 未解锁:保留队列(已限深),等用户手势触发后再播,避免回退成机械音。
  if (!unlocked) return
  playing = true
  const item = queue.shift()!
  let objectUrl: string | null = null
  try {
    const resp = await fetch(ttsUrl(item.personaId, item.text))
    if (!resp.ok) {
      // 503(无 key)或服务错误 → 优雅回退浏览器 TTS
      browserSpeak(item.personaId, item.text)
    } else {
      const blob = await resp.blob()
      objectUrl = URL.createObjectURL(blob)
      const a = getAudio()
      a.src = objectUrl
      await new Promise<void>((resolve) => {
        a.onended = () => resolve()
        a.onerror = () => resolve()
        a.play().then(() => { /* 播放中 */ }).catch(() => resolve())
      })
    }
  } catch {
    // 网络异常 → 回退浏览器 TTS
    browserSpeak(item.personaId, item.text)
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl)
    playing = false
    void playNext()
  }
}

/**
 * 朗读一条弹幕。静音时跳过;优先云端 CosyVoice,失败回退浏览器 TTS。
 * 串行队列;积压 >2 时丢弃旧的只保留最新。
 */
export function speakServer(personaId: string, text: string): void {
  if (isMuted() || !text) return
  if (queue.length > 2) queue = [{ personaId, text }]
  else queue.push({ personaId, text })
  void playNext()
}
