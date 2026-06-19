import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { PlayPage } from './pages/PlayPage.js'
import { ReviewPage } from './pages/ReviewPage.js'

// 极简 hash 路由 hook: 解析 window.location.hash
function useHashRoute(): { page: 'play' } | { page: 'review'; gameId: number } {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const m = hash.match(/^#\/review\/(\d+)$/)
  if (m) {
    return { page: 'review', gameId: Number(m[1]) }
  }
  return { page: 'play' }
}

function App() {
  const route = useHashRoute()
  if (route.page === 'review') {
    return <ReviewPage gameId={route.gameId} />
  }
  return <PlayPage />
}

createRoot(document.getElementById('root')!).render(<App />)
