import { createRoot } from 'react-dom/client'
import { useEffect, useState, lazy, Suspense } from 'react'
import './index.css'
// 页面级代码分割:按路由懒加载,把各页(及 recharts 等重依赖)拆出主 chunk,减小首屏体积
const PlayPage = lazy(() => import('./pages/PlayPage.js').then(m => ({ default: m.PlayPage })))
const ReviewPage = lazy(() => import('./pages/ReviewPage.js').then(m => ({ default: m.ReviewPage })))
const AnalysisPage = lazy(() => import('./pages/AnalysisPage.js').then(m => ({ default: m.AnalysisPage })))
const GrowthPage = lazy(() => import('./pages/GrowthPage.js').then(m => ({ default: m.GrowthPage })))
const TrainingPage = lazy(() => import('./pages/TrainingPage.js').then(m => ({ default: m.TrainingPage })))
const ConsolePage = lazy(() => import('./pages/console/ConsolePage.js').then(m => ({ default: m.ConsolePage })))
import { HTTP_BASE } from './api/config.js'
import { color, space, radius, fontSize, font, z } from './ui/theme.js'

// 极简 hash 路由 hook: 解析 window.location.hash
type Route =
  | { page: 'play' }
  | { page: 'review'; gameId: number }
  | { page: 'analysis'; gameId: number }
  | { page: 'growth' }
  | { page: 'training'; gameId: number }
  | { page: 'console' }

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
  if (hash === '#/console') return { page: 'console' }

  return { page: 'play' }
}

/** 极简内联图标(stroke 风格,统一 1.8 线宽;不使用 emoji 作结构图标) */
function Icon({ name }: { name: 'board' | 'growth' | 'console' | 'export' }) {
  const common = {
    width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none',
    stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
  }
  if (name === 'board') return (
    <svg {...common}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18M15 3v18" /></svg>
  )
  if (name === 'growth') return (
    <svg {...common}><path d="M3 17l6-6 4 4 8-8" /><path d="M21 7v5h-5" /></svg>
  )
  if (name === 'console') return (
    <svg {...common}><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" /></svg>
  )
  return ( // export
    <svg {...common}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>
  )
}

const NAV_LINKS = [
  { page: 'play', href: '#/', label: '对局', icon: 'board' as const },
  { page: 'growth', href: '#/growth', label: '成长', icon: 'growth' as const },
  { page: 'console', href: '#/console', label: '控制台', icon: 'console' as const },
]

function Nav({ active }: { active: Route['page'] }) {
  // 复盘/分析/训练是按局上下文页,归到「对局」高亮
  const activeTop = active === 'review' || active === 'analysis' || active === 'training' ? 'play' : active
  return (
    <nav style={navStyle} aria-label="主导航">
      <a href="#/" style={brandStyle} aria-label="围观象棋首页">
        <span style={brandMark} aria-hidden="true">♟</span>
        <span>围观象棋</span>
      </a>
      <div style={{ display: 'flex', gap: space.xs, alignItems: 'center' }}>
        {NAV_LINKS.map(l => {
          const on = activeTop === l.page
          return (
            <a key={l.page} href={l.href}
              style={{ ...navLink, ...(on ? navLinkActive : {}) }}
              aria-current={on ? 'page' : undefined}>
              <Icon name={l.icon} /><span>{l.label}</span>
            </a>
          )
        })}
      </div>
      <div style={{ marginLeft: 'auto' }}>
        <a href={`${HTTP_BASE}/export`} download="xiangqi-export.json" title="导出全部棋谱数据"
          style={{ ...navLink, color: color.textFaint }}>
          <Icon name="export" /><span>导出</span>
        </a>
      </div>
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
  } else if (route.page === 'console') {
    page = <ConsolePage />
  } else if (route.page === 'training') {
    page = <TrainingPage gameId={route.gameId} />
  } else {
    page = <PlayPage />
  }

  return (
    <>
      <Nav active={route.page} />
      <Suspense fallback={<div style={{ padding: space.xl, color: color.textMuted }}>加载中…</div>}>
        {page}
      </Suspense>
    </>
  )
}

const navStyle: React.CSSProperties = {
  position: 'sticky', top: 0, zIndex: z.sticky,
  display: 'flex', gap: space.lg, alignItems: 'center',
  padding: `0 ${space.xl}px`, height: 52,
  background: 'rgba(21,21,42,0.85)',
  backdropFilter: 'blur(8px)',
  borderBottom: `1px solid ${color.border}`,
}

const brandStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: space.sm,
  fontSize: fontSize.md, fontWeight: 700, color: color.gold,
  textDecoration: 'none', letterSpacing: '0.06em',
}

const brandMark: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  width: 26, height: 26, borderRadius: radius.sm,
  background: color.goldSoft, color: color.gold, fontSize: '1rem',
}

const navLink: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '6px 12px', borderRadius: radius.md,
  color: color.textMuted, textDecoration: 'none',
  fontSize: fontSize.base, fontFamily: font.sans, fontWeight: 500,
  transition: 'background .15s, color .15s',
}

const navLinkActive: React.CSSProperties = {
  background: color.goldSoft, color: color.gold, fontWeight: 700,
}

createRoot(document.getElementById('root')!).render(<App />)
