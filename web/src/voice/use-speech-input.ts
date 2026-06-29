import { useRef, useState, useCallback, useEffect } from 'react'
import { ASR_URL } from '../api/config.js'
import { encodeWav, downsampleMono } from './wav.js'

const TARGET_RATE = 16000

export function isSttSupported(): boolean {
  return typeof window !== 'undefined'
    && !!navigator.mediaDevices?.getUserMedia
    && typeof window.MediaRecorder !== 'undefined'
    && typeof window.AudioContext !== 'undefined'
}

/**
 * 点击开始录音(start),再点停止(stop)→ 录到的音频编码为 16k 单声道 WAV,
 * POST 给 /asr,识别出的文字回调 onResult(text)。
 * error 取值:'not-allowed'(麦克风权限)/'asr-failed'/'asr-unconfigured'/'no-speech'/'unsupported'。
 */
export function useSpeechInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)

  // 卸载清理:录音中卸载时停止 MediaRecorder 并释放所有 track,避免麦克风常亮。
  useEffect(() => () => {
    try { if (recRef.current?.state === 'recording') recRef.current.stop() } catch { /* 已停/无效 state */ }
    streamRef.current?.getTracks().forEach((t) => t.stop())
  }, [])

  const start = useCallback(async () => {
    if (listening) return
    setError(null)
    if (!isSttSupported()) { setError('unsupported'); return }
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      setError('not-allowed'); return
    }
    streamRef.current = stream
    chunksRef.current = []
    try {
      const rec = new MediaRecorder(stream)
      recRef.current = rec
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop())
        streamRef.current = null
        try {
          const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' })
          const wav = await blobToWav(blob)
          const res = await fetch(`${ASR_URL}?mime=audio/wav`, {
            method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: wav,
          })
          if (!res.ok) { setError(res.status === 503 ? 'asr-unconfigured' : 'asr-failed'); return }
          const { text } = (await res.json()) as { text: string }
          if (text && text.trim()) onResult(text.trim())
          else setError('no-speech')
        } catch {
          setError('asr-failed')
        } finally {
          setListening(false)
        }
      }
      rec.start()
      setListening(true)
    } catch {
      stream.getTracks().forEach((t) => t.stop())
      streamRef.current = null
      setError('asr-failed')
    }
  }, [listening, onResult])

  const stop = useCallback(() => {
    const rec = recRef.current
    if (rec && rec.state === 'recording') rec.stop()
  }, [])

  return { listening, start, stop, supported: isSttSupported(), error }
}

/** webm/opus Blob → 16k 单声道 16-bit WAV Blob(用 AudioContext 解码) */
async function blobToWav(blob: Blob): Promise<Blob> {
  const arrayBuf = await blob.arrayBuffer()
  const ctx = new AudioContext()
  try {
    const audioBuf = await ctx.decodeAudioData(arrayBuf)
    const ch = audioBuf.numberOfChannels
    const len = audioBuf.length
    const mono = new Float32Array(len)
    for (let c = 0; c < ch; c++) {
      const data = audioBuf.getChannelData(c)
      for (let i = 0; i < len; i++) mono[i] += data[i] / ch
    }
    const down = downsampleMono(mono, audioBuf.sampleRate, TARGET_RATE)
    return new Blob([encodeWav(down, TARGET_RATE)], { type: 'audio/wav' })
  } finally {
    await ctx.close()
  }
}
