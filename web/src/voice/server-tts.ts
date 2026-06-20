import { ttsUrl } from '../api/config.js'
import { isMuted, speak as browserSpeak } from './browser-tts.js'

/**
 * 云端 qwen3-tts-flash 语音播放,流水线预合成以降低时延。
 *
 * 关键设计:
 * 1. 手势解锁(保留原逻辑):复用单个 <audio> 元素,首次用户手势播放静音 WAV 解锁。
 * 2. 预合成流水线:speakServer 被调用时**立即**发起 fetch(合成 HTTP 请求),
 *    得到 Promise<url>,连同元数据推入有序队列。
 *    多条弹幕并发预热 → 后续播放时 urlPromise 大概率已 resolve,起播极快。
 * 3. drain 串行播放:取队首 → await urlPromise → 设 src → play → onended → 下一条。
 *    合成失败 → 回退 browserSpeak,继续下一条。
 * 4. 积压限制:队列 >3 时丢弃最旧,只保留最近 3 条。
 */

type QueueItem = {
  personaId: string
  text: string
  urlPromise: Promise<string>
}

let queue: QueueItem[] = []
let draining = false
let unlocked = false
let audioEl: HTMLAudioElement | null = null

// ── 手势解锁(原逻辑不动) ──────────────────────────────────────────────────

/** 生成极短静音 WAV data URI,用于在用户手势内解锁音频元素。 */
function silentWav(): string {
  const sampleRate = 8000
  const numSamples = 80 // ~10ms
  const dataSize = numSamples // 8-bit 单声道
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
    p.then(() => { unlocked = true; void drain() }).catch(() => { /* 仍未解锁,等下次手势 */ })
  } else {
    unlocked = true
    void drain()
  }
}

// 任意用户手势都尝试解锁;幂等。
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', tryUnlock)
  window.addEventListener('keydown', tryUnlock)
  window.addEventListener('touchstart', tryUnlock)
}

// ── 流水线 drain ──────────────────────────────────────────────────────────────

async function drain(): Promise<void> {
  if (draining || queue.length === 0) return
  if (!unlocked) return // 等待手势解锁后再播,避免回退成机械音
  draining = true

  while (queue.length > 0) {
    const item = queue.shift()!
    let url: string | null = null
    try {
      // await 预合成的 Promise;若合成已完成则立即返回 url
      url = await item.urlPromise
    } catch {
      // 合成失败(无 key / 网络 / 服务错误) → 回退浏览器 TTS
      browserSpeak(item.personaId, item.text)
      continue
    }

    // 用 OSS url 直接播放(浏览器从 CDN 流式拉,起播快)
    try {
      const a = getAudio()
      a.src = url
      await new Promise<void>((resolve) => {
        a.onended = () => resolve()
        a.onerror = () => resolve()
        a.play().catch(() => resolve())
      })
    } catch {
      // play 异常 → 静默跳过(不需要 browserSpeak,合成本身成功了)
    }
  }

  draining = false
}

// ── 公开 API ─────────────────────────────────────────────────────────────────

/**
 * 朗读一条弹幕。静音或空文本时跳过。
 * 立即发起合成请求(预热),推入有序队列;drain 负责串行播放。
 * 积压 >3 时丢弃最旧只保留最新 3 条。
 */
export function speakServer(personaId: string, text: string): void {
  if (isMuted() || !text) return

  // 立即发起合成 fetch(得到 Promise<url>),不等结果
  const urlPromise: Promise<string> = fetch(ttsUrl(personaId, text))
    .then((r) => {
      if (!r.ok) return Promise.reject(new Error(`TTS HTTP ${r.status}`))
      return r.json() as Promise<{ url: string }>
    })
    .then((j) => {
      if (!j.url) return Promise.reject(new Error('TTS 返回无 url'))
      return j.url
    })

  const newItem: QueueItem = { personaId, text, urlPromise }

  // 积压限制:超过 3 条时丢弃最旧,只保留最新 3 条 + 新增 1 条
  if (queue.length >= 3) {
    queue = queue.slice(queue.length - 2) // 保留最近 2 条
  }
  queue.push(newItem)

  void drain()
}
