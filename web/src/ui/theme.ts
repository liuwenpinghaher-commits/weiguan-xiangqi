/**
 * 围观象棋 · 设计系统单一真源(语义色 token + 间距/圆角/字体/层级 + 组件样式工厂)。
 *
 * 设计取向:暗色"实时直播"风,沿用本产品已有的身份——藏青底 + 帝王金 + 朱红,
 * 系统化为语义角色。所有页面/组件从这里取值,不再各处硬编码 hex。
 */
import type { CSSProperties } from 'react'

/** 语义色 token */
export const color = {
  // 表面层级(由深到浅,制造纵深)
  bg: '#15152a',            // 应用最底背景
  surface: '#1e1e38',       // 卡片/侧栏(抬升面)
  surfaceAlt: 'rgba(255,255,255,0.05)', // 次级面板
  surfaceHover: 'rgba(255,255,255,0.08)',
  // 边框
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  // 文字(对暗面满足 WCAG)
  text: '#ececf2',          // 主文本
  textMuted: '#a6a6b8',     // 次要文本(≥4.5:1 on surface)
  textFaint: '#7a7a90',     // 提示/三级
  // 品牌 / 主色
  gold: '#f5c518',          // 主色 / 标题 / 高亮
  goldSoft: 'rgba(245,197,24,0.14)',
  goldBorder: 'rgba(245,197,24,0.45)',
  onGold: '#1a1a2e',        // 金底上的文字
  // 棋方 / 语义
  red: '#d8503c',           // 红方 / 危险强调
  redSoft: 'rgba(216,80,60,0.14)',
  black: '#2b2b3a',         // 黑方
  success: '#43b65a',
  successSoft: 'rgba(67,182,90,0.14)',
  info: '#3b82f6',
  infoSoft: 'rgba(59,130,246,0.16)',
  warning: '#d9870b',
  danger: '#e5484d',
  dangerSoft: 'rgba(229,72,77,0.14)',
} as const

/** 角色(persona)固定色——与服务端弹幕身份一致 */
export const personaColor: Record<string, string> = {
  player: '#e0533c',
  laopaoer: '#e67e22',
  coach: '#43b65a',
  netizen: '#3b82f6',
  human: '#8e44ad',
}

/** 间距(4/8 节奏) */
export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 } as const

/** 圆角 */
export const radius = { sm: 6, md: 10, lg: 14, pill: 999 } as const

/** 字体栈——统一无衬线,数字用等宽列对齐 */
export const font = {
  sans: '"Noto Sans SC", system-ui, -apple-system, "Segoe UI", Roboto, "PingFang SC", "Microsoft YaHei", sans-serif',
  mono: '"SFMono-Regular", ui-monospace, "JetBrains Mono", Menlo, Consolas, monospace',
} as const

/** 字号阶梯 */
export const fontSize = {
  xs: '0.72rem', sm: '0.8rem', base: '0.9rem', md: '1rem',
  lg: '1.15rem', xl: '1.4rem', xxl: '1.9rem',
} as const

/** 阴影阶梯 */
export const shadow = {
  card: '0 2px 12px rgba(0,0,0,0.35)',
  raised: '0 8px 32px rgba(0,0,0,0.5)',
} as const

/** z-index 层级 */
export const z = { base: 0, sticky: 40, overlay: 100, modal: 1000 } as const

// ── 组件样式工厂 ──────────────────────────────────────────────

export type BtnVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'success' | 'info'

/** 按钮样式(主次纪律:primary=金,secondary=描边,ghost=透明,语义色用于对应动作) */
export function btn(variant: BtnVariant = 'secondary', opts: { size?: 'sm' | 'md' | 'lg'; active?: boolean } = {}): CSSProperties {
  const size = opts.size ?? 'md'
  const pad = size === 'lg' ? '11px 28px' : size === 'sm' ? '5px 14px' : '8px 18px'
  const fs = size === 'lg' ? fontSize.md : size === 'sm' ? fontSize.sm : fontSize.base
  const base: CSSProperties = {
    padding: pad, fontSize: fs, fontFamily: font.sans, fontWeight: 600,
    border: '1px solid transparent', borderRadius: radius.md,
    cursor: 'pointer', transition: 'background .15s, border-color .15s, opacity .15s',
    lineHeight: 1.2, whiteSpace: 'nowrap',
  }
  const variants: Record<BtnVariant, CSSProperties> = {
    primary: { background: color.gold, color: color.onGold, fontWeight: 700 },
    secondary: { background: color.surfaceAlt, color: color.text, borderColor: color.borderStrong },
    ghost: { background: 'transparent', color: color.textMuted, borderColor: 'transparent' },
    danger: { background: color.red, color: '#fff', fontWeight: 700 },
    success: { background: color.success, color: '#fff', fontWeight: 700 },
    info: { background: color.info, color: '#fff', fontWeight: 700 },
  }
  return { ...base, ...variants[variant] }
}

/** 选择型药丸按钮(模式/执棋方等单选) */
export function pill(active: boolean, activeColor: string = color.gold, onActive: string = color.onGold): CSSProperties {
  return {
    padding: '6px 16px', fontSize: fontSize.base, fontFamily: font.sans,
    borderRadius: radius.pill, cursor: 'pointer', fontWeight: active ? 700 : 500,
    transition: 'all .15s',
    background: active ? activeColor : color.surfaceAlt,
    color: active ? onActive : color.textMuted,
    border: `1px solid ${active ? activeColor : color.border}`,
  }
}

/** 卡片容器 */
export const card: CSSProperties = {
  background: color.surface,
  border: `1px solid ${color.border}`,
  borderRadius: radius.lg,
  padding: `${space.lg}px ${space.xl}px`,
  marginBottom: space.lg,
  boxShadow: shadow.card,
}

/** 区块标题(金色) */
export const heading: CSSProperties = {
  color: color.gold, fontWeight: 700, letterSpacing: '0.04em', margin: 0,
}

/** 暗色表格样式 */
export const th: CSSProperties = {
  textAlign: 'left', padding: '7px 10px',
  borderBottom: `1px solid ${color.borderStrong}`,
  color: color.textMuted, fontWeight: 600, fontSize: fontSize.sm,
}
export const tr: CSSProperties = { borderBottom: `1px solid ${color.border}` }
export const td: CSSProperties = { padding: '8px 10px', color: color.text, fontSize: fontSize.base }
