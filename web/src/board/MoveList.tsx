import { useEffect } from 'react'
import { color, fontSize, radius, space } from '../ui/theme.js'

export interface MoveEntry {
  ply: number
  move: string
  side: 'red' | 'black'
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

  const rows: { ply: number; red?: string; black?: string }[] = []
  for (const m of moves) {
    const rowIdx = Math.floor((m.ply - 1) / 2)
    if (!rows[rowIdx]) rows[rowIdx] = { ply: rowIdx + 1 }
    if (m.side === 'red') rows[rowIdx].red = m.move
    else rows[rowIdx].black = m.move
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
              style={{ ...styles.moveCell, ...(currentPly === redPly ? styles.activeMove : {}) }}
              onClick={() => onNavigate(redPly)}
            >{row.red ?? ''}</span>
            <span
              style={{ ...styles.moveCell, ...(currentPly === blackPly ? styles.activeMove : {}) }}
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
    maxHeight: 300,
    overflowY: 'auto',
    border: `1px solid ${color.border}`,
    borderRadius: radius.md,
    padding: space.sm,
    background: color.surface,
  },
  empty: { color: color.textMuted, fontSize: fontSize.sm, textAlign: 'center', padding: space.md },
  row: { display: 'flex', gap: 4, padding: '2px 6px', borderRadius: 4, fontSize: fontSize.sm },
  activeRow: { background: color.goldSoft },
  plyNum: { width: 32, color: color.textMuted, textAlign: 'right', flexShrink: 0 },
  moveCell: { flex: 1, cursor: 'pointer', padding: '0 4px', borderRadius: 3 },
  activeMove: { background: color.gold, color: '#fff', fontWeight: 600 },
}
