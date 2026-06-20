import { createRoot } from 'react-dom/client'
import { useEffect, useState } from 'react'
import { PlayPage } from './pages/PlayPage.js'
import { ReviewPage } from './pages/ReviewPage.js'
import { AnalysisPage } from './pages/AnalysisPage.js'
import { GrowthPage } from './pages/GrowthPage.js'
import { TrainingPage } from './pages/TrainingPage.js'
import { HTTP_BASE } from './api/config.js'

// 极简 hash 路由 hook: 解析 window.location.hash
type Route =
  | { page: 'play' }
  | { page: 'review'; gameId: number }
  | { page: 'analysis'; gameId: number }
  | { page: 'growth' }
  | { page: 'training'; gameId: number }

function useHashRoute(): Route {
  const [hash, setHash] = useState(window.location.hash)

  useEffect(() => {
    const handler = () => setHash(window.location.hash)
    window.addEventListener('hashchange', handler)
    return () => window.removeEventListener('hashchange', handler)
  }, [])

  const mReview = hash.match(/^#\/review\/(\d+)$/)
  if (mReview) return { page: 'review', gameId: Number(mReview[1]) }

  const mAnalysis = hash.match(/^#\/analysis\/(\d+)$/)
  if (mAnalysis) return { page: 'analysis', gameId: Number(mAnalysis[1]) }

  const mTraining = hash.match(/^#\/training\/(\d+)$/)
  if (mTraining) return { page: 'training', gameId: Number(mTraining[1]) }

  if (hash === '#/growth') return { page: 'growth' }

  return { page: 'play' }
}

const NAV_STYLE: React.CSSProperties = {
  display: 'flex',
  gap: '16px',
  alignItems: 'center',
  padding: '6px 16px',
  background: '#1a1a2e',
  borderBottom: '1px solid #333',
  fontSize: '13px',
}

const LINK_STYLE: React.CSSProperties = {
  color: '#ccc',
  textDecoration: 'none',
}

function Nav() {
  return (
    <nav style={NAV_STYLE}>
      <a href="#/" style={LINK_STYLE}>对局</a>
      <span style={{ color: '#555' }}>|</span>
      <a href="#/growth" style={LINK_STYLE}>成长</a>
      <span style={{ color: '#555' }}>|</span>
      <a href={`${HTTP_BASE}/export`} style={LINK_STYLE} download="xiangqi-export.json" title="导出全部棋谱数据">
        导出全部
      </a>
    </nav>
  )
}

function App() {
  const route = useHashRoute()

  let page: JSX.Element
  if (route.page === 'review') {
    page = <ReviewPage gameId={route.gameId} />
  } else if (route.page === 'analysis') {
    page = <AnalysisPage gameId={route.gameId} />
  } else if (route.page === 'growth') {
    page = <GrowthPage />
  } else if (route.page === 'training') {
    page = <TrainingPage gameId={route.gameId} />
  } else {
    page = <PlayPage />
  }

  return (
    <>
      <Nav />
      {page}
    </>
  )
}

createRoot(document.getElementById('root')!).render(<App />)
