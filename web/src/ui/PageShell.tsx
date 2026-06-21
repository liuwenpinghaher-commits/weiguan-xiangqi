import type { ReactNode } from 'react'
import { color, space, radius, font, fontSize, shadow, card, heading, th, tr, td } from './theme.js'

/** 暗色页面容器。分析/成长/训练/复盘页共用,内容居中限宽。 */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div style={shellStyle}>
      <div style={contentStyle}>{children}</div>
    </div>
  )
}

const shellStyle: React.CSSProperties = {
  minHeight: 'calc(100dvh - 52px)',
  background: color.bg,
  color: color.text,
  fontFamily: font.sans,
  padding: `${space.xl}px ${space.lg}px`,
}

const contentStyle: React.CSSProperties = {
  maxWidth: 1080,
  margin: '0 auto',
}

/** 卡片容器(token 派生) */
export const cardStyle: React.CSSProperties = card

/** 区块标题色 */
export const headingStyle: React.CSSProperties = heading

/** 暗色表格 th / tr / td */
export const darkThStyle: React.CSSProperties = th
export const darkTrStyle: React.CSSProperties = tr
export const darkTdStyle: React.CSSProperties = td

/** 通用错误提示块 */
export function ErrorBanner({ msg }: { msg: string }) {
  return (
    <div style={errorBannerStyle} role="alert">⚠ {msg}</div>
  )
}

const errorBannerStyle: React.CSSProperties = {
  background: color.dangerSoft,
  border: `1px solid ${color.danger}`,
  borderRadius: radius.md,
  padding: '12px 16px',
  color: color.danger,
  fontSize: fontSize.base,
  marginBottom: space.lg,
  boxShadow: shadow.card,
}
