import { useRef, useState, useCallback } from 'react'

// webkitSpeechRecognition 不在标准 TS lib,用最小 any 取用(不加 @types)
function getRecognitionCtor(): any {
  if (typeof window === 'undefined') return null
  return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null
}

export function isSttSupported(): boolean {
  return getRecognitionCtor() !== null
}

/**
 * 一次性中文听写。调用 start() 开始听,识别到结果回调 onResult(text) 并自动停止。
 * 返回 listening 状态与 error 原因用于 UI。
 * error 常见值：'not-allowed' / 'no-speech' / 'network' / 'audio-capture' / 其他浏览器字符串。
 */
export function useSpeechInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const recRef = useRef<any>(null)

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || listening) return
    setError(null)
    const rec = new Ctor()
    recRef.current = rec
    rec.lang = 'zh-CN'
    rec.interimResults = false
    rec.maxAlternatives = 1
    rec.onresult = (e: any) => {
      const text = e.results?.[0]?.[0]?.transcript ?? ''
      if (text) onResult(text)
    }
    rec.onend = () => setListening(false)
    rec.onerror = (e: any) => {
      // e.error 为浏览器标准错误码字符串
      setError((e?.error as string) ?? 'error')
      setListening(false)
    }
    setListening(true)
    rec.start()
  }, [listening, onResult])

  const stop = useCallback(() => {
    recRef.current?.stop?.()
    setListening(false)
  }, [])

  return { listening, start, stop, supported: isSttSupported(), error }
}
