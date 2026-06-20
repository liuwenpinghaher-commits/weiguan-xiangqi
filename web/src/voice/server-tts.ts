import { ttsUrl } from '../api/config.js'
import { isMuted, speak as browserSpeak } from './browser-tts.js'

/**
 * 串行播放队列。
 * 每次调用 speakServer 都将一个任务推入队列;
 * 队列积压 >2 时丢弃旧的只保留最新;
 * 每个任务:fetch 云端 TTS → blob → Audio.play();失败时回退浏览器 TTS。
 */
type QueueItem = { personaId: string; text: string }

let queue: QueueItem[] = []
let playing = false

async function playNext(): Promise<void> {
  if (playing || queue.length === 0) return
  playing = true
  const item = queue.shift()!
  let objectUrl: string | null = null
  try {
    const url = ttsUrl(item.personaId, item.text)
    const resp = await fetch(url)
    if (!resp.ok) {
      // 503 或其他错误 → 回退浏览器 TTS
      browserSpeak(item.personaId, item.text)
    } else {
      const blob = await resp.blob()
      objectUrl = URL.createObjectURL(blob)
      const audio = new Audio(objectUrl)
      await new Promise<void>((resolve) => {
        audio.onended = () => resolve()
        audio.onerror = () => {
          // 音频播放失败 → 回退浏览器 TTS
          browserSpeak(item.personaId, item.text)
          resolve()
        }
        audio.play().catch(() => {
          // play() promise 被 reject(如 autoplay 被限制) → 回退
          browserSpeak(item.personaId, item.text)
          resolve()
        })
      })
    }
  } catch {
    // fetch 失败(离线/无 key) → 回退浏览器 TTS
    browserSpeak(item.personaId, item.text)
  } finally {
    if (objectUrl) {
      URL.revokeObjectURL(objectUrl)
    }
    playing = false
    // 继续播放下一条
    void playNext()
  }
}

/**
 * 朗读一条弹幕。
 * - 静音时跳过。
 * - 优先走服务端 CosyVoice;503/fetch 失败时回退浏览器 TTS。
 * - 串行队列;积压 >2 时丢弃旧的只保留最新。
 */
export function speakServer(personaId: string, text: string): void {
  if (isMuted() || !text) return

  // 队列过深:丢弃旧的只留最新
  if (queue.length > 2) {
    queue = [{ personaId, text }]
  } else {
    queue.push({ personaId, text })
  }

  void playNext()
}
