import { ttsUrl } from '../api/config.js'
import { isMuted, speak as browserSpeak } from './browser-tts.js'

/**
 * 服务端本地 TTS(moss-tts-nano)语音播放,流水线预合成以降低时延。
 * 后端 /tts 路由调用本地 moss-tts-nano 合成 WAV;不可用时前端回退浏览器 Web Speech。
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
  /** 这条语音"开始播放"(或被丢弃/回退)时回调一次,供 UI 同步揭示对应气泡 */
  onStart?: () => void
  started?: boolean
}

/** 触发 item.onStart 一次(幂等);用于文字-语音同步:气泡在声音起播的瞬间显示。 */
function fireStart(item: QueueItem): void {
  if (item.started) return
  item.started = true
  try { item.onStart?.() } catch { /* UI 回调异常不应影响播放 */ }
}

let queue: QueueItem[] = []
let draining = false
let unlocked = false
let audioEl: HTMLAudioElement | null = null
let generation = 0

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

/** 统一移除三个手势解锁监听(解锁成功后调用,避免泄漏)。 */
function removeAllUnlockListeners(): void {
  if (typeof window === 'undefined') return
  window.removeEventListener('pointerdown', onUnlockGesture)
  window.removeEventListener('keydown', onUnlockGesture)
  window.removeEventListener('touchstart', onUnlockGesture)
}

/** 在用户手势内调用:播放静音以解锁音频元素,之后可程序化播放。 */
function onUnlockGesture(): void {
  if (unlocked) return
  const a = getAudio()
  a.src = silentWav()
  const p = a.play()
  if (p && typeof p.then === 'function') {
    p.then(() => { unlocked = true; removeAllUnlockListeners(); void drain() })
      .catch(() => { /* 仍未解锁,等下次手势;本次 once 已自移除,其余两个监听仍在 */ })
  } else {
    unlocked = true
    removeAllUnlockListeners()
    void drain()
  }
}

// 任意用户手势都尝试解锁;幂等。{ once: true } 让首个触发的监听自动移除,
// 解锁成功后再主动移除其余两个;解锁失败(play 被拒)时不移除,留待下次手势。
if (typeof window !== 'undefined') {
  window.addEventListener('pointerdown', onUnlockGesture, { once: true })
  window.addEventListener('keydown', onUnlockGesture, { once: true })
  window.addEventListener('touchstart', onUnlockGesture, { once: true })
}

// ── 流水线 drain ──────────────────────────────────────────────────────────────

async function drain(): Promise<void> {
  if (draining || queue.length === 0) return
  if (!unlocked) return // 等待手势解锁后再播,避免回退成机械音
  draining = true

  const gen = generation
  while (queue.length > 0) {
    const item = queue.shift()!
    if (gen !== generation) break // stopVoice 在出队前后触发 → 中止本轮 drain
    let url: string | null = null
    try {
      // await 预合成的 Promise;若合成已完成则立即返回 url
      url = await item.urlPromise
    } catch {
      // 合成失败(无 key / 网络 / 服务错误) → 回退浏览器 TTS。
      // 仍要 fireStart:让对应气泡照常揭示(否则同步模式下会卡住后续所有气泡)。
      fireStart(item)
      browserSpeak(item.personaId, item.text)
      continue
    }
    if (gen !== generation) break // await 期间 stopVoice 触发 → 不要再 play 这条残留

    // 用后端返回的本地 /static/tts 相对 url 直接播放(同源静态文件,起播快)。
    // 此刻起这条就是"正在播放的一句"→ fireStart 让 UI 同步揭示该气泡(文字随声音出现)。
    try {
      const a = getAudio()
      a.src = url
      fireStart(item)
      let failed = false
      try {
        await new Promise<void>((resolve) => {
          a.onended = () => resolve()
          a.onerror = () => { failed = true; resolve() }
          a.play().catch(() => { failed = true; resolve() })
        })
      } finally {
        // 清掉本条的播放回调,避免复用同一 audio 元素时旧闭包与下一条交叉触发。
        a.onended = a.onerror = null
      }
      // 合成成功但 wav 损坏/播放被拒 → 回退浏览器 TTS,该句不再静默无声
      if (failed) browserSpeak(item.personaId, item.text)
    } catch {
      browserSpeak(item.personaId, item.text)
    }
  }

  draining = false
}

// ── 公开 API ─────────────────────────────────────────────────────────────────

/** 立即静音:停当前播放 + 清空预合成队列。暂停整局时调用,确保正在播/排队的语音立刻停。 */
export function stopVoice(): void {
  generation++
  queue = []
  if (audioEl) {
    try { audioEl.pause() } catch { /* 忽略 */ }
    // 清掉残留播放回调,避免被中止的旧一句在 stop 后仍 resolve 干扰新局。
    audioEl.onended = audioEl.onerror = null
    audioEl.src = ''
  }
  // 重置 draining,让 drain 入口可重入(配合 gen !== generation 守卫,
  // 旧循环醒来会自行 break,不会重复播);避免残留 true 让新局静音。
  draining = false
}

/**
 * 朗读一条弹幕。静音或空文本时跳过。
 * 立即发起合成请求(预热),推入有序队列;drain 负责串行播放。
 * 积压 >3 时丢弃最旧只保留最新 3 条。
 */
export function speakServer(personaId: string, text: string, onStart?: () => void): void {
  // 静音/空文本不播,但仍要回调 onStart——同步模式下气泡靠它揭示,不能卡住。
  if (isMuted() || !text) { onStart?.(); return }

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

  const newItem: QueueItem = { personaId, text, urlPromise, onStart }

  // 积压限制:超过 3 条时丢弃最旧,只保留最新 3 条 + 新增 1 条。
  // 被丢弃的不播,但要 fireStart 揭示其气泡(否则同步模式下后续气泡永远等不到它)。
  if (queue.length >= 3) {
    const dropped = queue.slice(0, queue.length - 2)
    dropped.forEach(fireStart)
    queue = queue.slice(queue.length - 2) // 保留最近 2 条
  }
  queue.push(newItem)

  void drain()
}
