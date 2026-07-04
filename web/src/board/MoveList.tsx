import { useEffect } from 'react'
import { color, fontSize, radius, space } from '../ui/theme.js'

export interface MoveEntry {
  ply: number
  move: string          // UCI 原始着法(如 h2e2),用于导航/高亮
  side: 'red' | 'black'
  zh?: string           // 中文棋谱注记(如 炮二平五),由服务端 describeMoveZh 计算;缺失时回退 move
}

interface MoveListProps {
  moves: MoveEntry[]
  currentPly: number
  onNavigate: (ply: number) => void
}

export function MoveList({ moves, currentPly, onNavigate }: MoveListProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'ArrowLeft') onNavigate(Math.max(0, currentPly - 1))
      if (e.key === 'ArrowRight') onNavigate(Math.min(moves.length, currentPly + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [currentPly, moves.length, onNavigate])

  if (moves.length === 0) {
    return <div style={styles.empty}>暂无走法</div>
  }

  // 每手优先显示中文棋谱注记(炮二平五…),服务端未算出时回退 UCI。
  // 去掉注记里的「红/黑」前缀:红黑已由左右两列 + 颜色区分,前缀在此冗余(UCI 回退不受影响)。
  const rows: { ply: number; red?: string; black?: string }[] = []
  for (const m of moves) {
    const rowIdx = Math.floor((m.ply - 1) / 2)
    if (!rows[rowIdx]) rows[rowIdx] = { ply: rowIdx + 1 }
    const label = (m.zh ?? m.move).replace(/^[红黑]/, '')
    if (m.side === 'red') rows[rowIdx].red = label
    else rows[rowIdx].black = label
  }

  return (
    <div style={styles.container} role="list" aria-label="走法历史">
      {rows.map((row, i) => {
        const redPly = i * 2 + 1
        const blackPly = i * 2 + 2
        return (
          <div
            key={i}
            style={{
              ...styles.row,
              ...(currentPly === redPly || currentPly === blackPly ? styles.activeRow : {}),
            }}
            role="listitem"
          >
            <span style={styles.plyNum}>{row.ply}.</span>
            <span
              style={{ ...styles.moveCell, ...styles.redMove, ...(currentPly === redPly ? styles.activeMove : {}) }}
              onClick={() => onNavigate(redPly)}
            >{row.red ?? ''}</span>
            <span
              style={{ ...styles.moveCell, ...styles.blackMove, ...(currentPly === blackPly ? styles.activeMove : {}) }}
              onClick={() => onNavigate(blackPly)}
            >{row.black ?? ''}</span>
          </div>
        )
      })}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    // 高度随外层伸缩(桌面固定视口下由父 flex 容器约束),内部滚动;窄屏由父层给 maxHeight 兜底
    maxHeight: '100%',
    minHeight: 0,
    width: '100%',
    boxSizing: 'border-box',
    overflowY: 'auto',
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    padding: space.sm,
    background: color.surface,
  },
  empty: { color: color.textMuted, fontSize: fontSize.sm, textAlign: 'center', padding: space.md },
  row: { display: 'flex', gap: 4, padding: '2px 6px', borderRadius: 4, fontSize: fontSize.sm, alignItems: 'baseline' },
  activeRow: { background: color.goldSoft },
  plyNum: { width: 32, color: color.textMuted, textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' },
  moveCell: { flex: 1, cursor: 'pointer', padding: '0 6px', borderRadius: 3, letterSpacing: '0.03em' },
  redMove: { color: '#c0392b', fontWeight: 500 },   // 红方着法用红色,贴近棋谱惯例
  blackMove: { color: color.text, fontWeight: 500 },
  activeMove: { background: color.gold, color: '#fff', fontWeight: 700 },
}
