import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { VoiceProfile } from './voice-profiles.js'
import type { TtsCfg } from '../config/defaults.js'

const TTS_OUTPUT_DIR = join(import.meta.dirname, '..', '..', 'static', 'tts')
const TTS_TIMEOUT_MS = 30_000

function ensureOutputDir(): void {
  if (!existsSync(TTS_OUTPUT_DIR)) mkdirSync(TTS_OUTPUT_DIR, { recursive: true })
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 流式合成:调用 moss-tts-nano /api/generate-stream/start,
 * 轮询收集音频块,拼接成完整 WAV 写入 static/tts/,
 * 返回可访问的相对 URL 路径。
 *
 * 失败时若 streaming=true 且流式失败,回退 /api/generate 一次性合成。
 */
export async function synthesizeAudio(
  text: string,
  profile: VoiceProfile,
  cfg: TtsCfg,
): Promise<string> {
  const clipped = text.slice(0, 500)
  const id = uid()
  ensureOutputDir()
  const outputPath = join(TTS_OUTPUT_DIR, `${id}.wav`)

  if (cfg.streaming) {
    try {
      const wav = await synthesizeStream(clipped, profile, cfg)
      writeFileSync(outputPath, wav)
      return `/static/tts/${id}.wav`
    } catch (err) {
      // 流式失败,回退一次性生成(仅当错误与 stream 相关时)
      const msg = (err as Error).message ?? ''
      if (!msg.includes('stream') && !msg.includes('ECONNREFUSED')) throw err
    }
  }

  // 一次性生成(非流式或流式回退)
  const wav = await synthesizeOnce(clipped, profile, cfg)
  writeFileSync(outputPath, wav)
  return `/static/tts/${id}.wav`
}

/**
 * 流式合成: POST /api/generate-stream/start → 轮询音频块 → 拼接返回 Buffer
 */
async function synthesizeStream(
  text: string,
  profile: VoiceProfile,
  cfg: TtsCfg,
): Promise<Buffer> {
  const base = cfg.mossNanoUrl

  // 1. 启动流式生成
  const startBody = new FormData()
  startBody.append('text', text)
  startBody.append('text_temperature', String(profile.textTemperature))
  startBody.append('audio_temperature', String(profile.audioTemperature))
  startBody.append('audio_top_p', String(profile.audioTopP))
  startBody.append('audio_top_k', String(profile.audioTopK))
  startBody.append('audio_repetition_penalty', String(profile.audioRepetitionPenalty))
  startBody.append('max_new_frames', String(profile.maxNewFrames))
  startBody.append('enable_text_normalization', '1')
  startBody.append('do_sample', '1')

  // 附加参考音频文件
  const refPath = profile.referenceAudio || cfg.referenceAudio
  const refFull = join(import.meta.dirname, '..', '..', refPath)
  if (existsSync(refFull)) {
    const buf = await readFile(refFull)
    const blob = new Blob([buf], { type: 'audio/wav' })
    startBody.append('prompt_audio', blob, 'reference.wav')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS)
  try {
    const startResp = await fetch(`${base}/api/generate-stream/start`, {
      method: 'POST',
      body: startBody,
      signal: ctrl.signal,
    })
    if (!startResp.ok) {
      throw new Error(`moss-tts-nano stream start HTTP ${startResp.status}`)
    }

    const json = (await startResp.json()) as { stream_id?: string }
    const streamId = json.stream_id
    if (!streamId) throw new Error('moss-tts-nano 未返回 stream_id')

    // 2. 轮询收集音频块
    const chunks: Buffer[] = []
    let done = false
    while (!done) {
      const statusResp = await fetch(`${base}/api/generate-stream/${streamId}/status`, {
        signal: ctrl.signal,
      })
      if (!statusResp.ok) {
        throw new Error(`moss-tts-nano stream status HTTP ${statusResp.status}`)
      }
      const status = (await statusResp.json()) as {
        state: string; ready: boolean; failed: boolean; error?: string
      }

      if (status.failed) {
        throw new Error(`moss-tts-nano stream failed: ${status.error ?? 'unknown'}`)
      }

      // 获取音频
      const audioResp = await fetch(`${base}/api/generate-stream/${streamId}/audio`, {
        signal: ctrl.signal,
      })
      if (audioResp.ok) {
        const arrBuf = await audioResp.arrayBuffer()
        if (arrBuf.byteLength > 0) chunks.push(Buffer.from(arrBuf))
      }

      if (status.ready) {
        done = true
        try {
          await fetch(`${base}/api/generate-stream/${streamId}/close`, { method: 'POST' })
        } catch { /* best-effort close */ }
      } else {
        // 等待 80ms 再轮询
        await new Promise<void>(r => setTimeout(r, 80))
      }
    }

    if (chunks.length === 0) throw new Error('moss-tts-nano 流式生成无音频数据')
    return Buffer.concat(chunks)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 一次性合成(流式失败时的回退): POST /api/generate → 返回 base64 WAV buffer
 */
async function synthesizeOnce(
  text: string,
  profile: VoiceProfile,
  cfg: TtsCfg,
): Promise<Buffer> {
  const base = cfg.mossNanoUrl

  const body = new FormData()
  body.append('text', text)
  body.append('text_temperature', String(profile.textTemperature))
  body.append('audio_temperature', String(profile.audioTemperature))
  body.append('audio_top_p', String(profile.audioTopP))
  body.append('audio_top_k', String(profile.audioTopK))
  body.append('audio_repetition_penalty', String(profile.audioRepetitionPenalty))
  body.append('max_new_frames', String(profile.maxNewFrames))
  body.append('enable_text_normalization', '1')
  body.append('do_sample', '1')

  const refPath = profile.referenceAudio || cfg.referenceAudio
  const refFull = join(import.meta.dirname, '..', '..', refPath)
  if (existsSync(refFull)) {
    const buf = await readFile(refFull)
    const blob = new Blob([buf], { type: 'audio/wav' })
    body.append('prompt_audio', blob, 'reference.wav')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS)
  try {
    const resp = await fetch(`${base}/api/generate`, {
      method: 'POST',
      body,
      signal: ctrl.signal,
    })
    if (!resp.ok) {
      throw new Error(`moss-tts-nano generate HTTP ${resp.status}`)
    }
    const json = (await resp.json()) as { audio_base64?: string; error?: string }
    if (json.error) throw new Error(json.error)
    if (!json.audio_base64) throw new Error('moss-tts-nano 返回无音频数据')
    return Buffer.from(json.audio_base64, 'base64')
  } finally {
    clearTimeout(timer)
  }
}
