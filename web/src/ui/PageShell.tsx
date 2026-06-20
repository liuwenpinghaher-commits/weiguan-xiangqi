import type { ReactNode } from 'react'

/** 与 PlayPage 一致的暗色背景页面容器。分析/成长/训练/复盘页共用。 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={shellStyle}>
      {children}
    </div>
  )
}

const shellStyle: React.CSSProperties = {
  minHeight: '100vh',
  background: '#1a1a2e',
  color: '#eee',
  fontFamily: '"Noto Serif SC", "Source Han Serif", serif',
  padding: '24px 16px',
}

/** 暗色页面内的卡片容器 */
export const cardStyle: React.CSSProperties = {
  background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  padding: '16px 20px',
  marginBottom: 16,
}

/** 暗色页面内的标题色 */
export const headingStyle: React.CSSProperties = {
  color: '#f5c518',
  fontWeight: 700,
  letterSpacing: '0.05em',
}

/** 暗色表格 th */
export const darkThStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '1px solid #444',
  color: '#aaa',
  fontWeight: 600,
}

/** 暗色表格 tr 分隔 */
export const darkTrStyle: React.CSSProperties = {
  borderBottom: '1px solid #2a2a3e',
}

/** 暗色表格 td */
export const darkTdStyle: React.CSSProperties = {
  padding: '7px 10px',
  color: '#ddd',
}

/** 通用错误提示块 */
export function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={errorBannerStyle} role="alert">
      ⚠️ {msg}
    </div>
  )
}

const errorBannerStyle: React.CSSProperties = {
  background: 'rgba(255,82,82,0.12)',
  border: '1px solid rgba(255,82,82,0.4)',
  borderRadius: 8,
  padding: '12px 16px',
  color: '#ff6b6b',
  fontSize: '0.9rem',
  marginBottom: 16,
}
