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
 * 返回 listening 状态用于 UI(麦克风高亮)。
 */
export function useSpeechInput(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const recRef = useRef<any>(null)

  const start = useCallback(() => {
    const Ctor = getRecognitionCtor()
    if (!Ctor || listening) return
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
    rec.onerror = () => setListening(false)
    setListening(true)
    rec.start()
  }, [listening, onResult])

  const stop = useCallback(() => {
    recRef.current?.stop?.()
    setListening(false)
  }, [])

  return { listening, start, stop, supported: isSttSupported() }
}
