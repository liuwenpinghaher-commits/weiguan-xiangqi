import { useState, useEffect } from 'react'

const NARROW_QUERY = '(max-width: 820px)'

/**
 * 返回当前视口是否为窄屏（<= 820px）。
 * 监听 matchMedia 变化，切换断点时自动更新。
 */
export function useIsNarrow(): boolean {
  const [isNarrow, setIsNarrow] = useState<boolean>(
    () => window.matchMedia(NARROW_QUERY).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(NARROW_QUERY)
    const handler = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
    mql.addEventListener('change', handler)
    return () => mql.removeEventListener('change', handler)
  }, [])

  return isNarrow
}
