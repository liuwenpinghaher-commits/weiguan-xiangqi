# Phase 1: 对弈核心体验升级 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add chess clock, resign/draw/undo, move history panel, legal move indicators, board flip, and piece animation to the gameplay experience.

**Architecture:** Server-side clock+resign/draw/undo in GameSession + ws-server message handlers. Frontend MoveList component + Board enhancements + PlayPage integration. Legal moves via new HTTP endpoint.

**Tech Stack:** TypeScript, React 18, Fastify, Vitest, react-xiangqiboard, elephantops

---

### Task 1: Add clock config to EngineCfg

**Files:**
- Modify: `server/src/config/defaults.ts:7,21`
- Modify: `server/src/config/validate.ts:50`

- [ ] **Step 1: Add clock fields to EngineCfg**

In `server/src/config/defaults.ts`, add to the `EngineCfg` interface after `movetime`:
```typescript
export interface EngineCfg {
  pikafishPath: string | null; multipv: number; movetime: number
  clockInitialSeconds: number
  clockIncrementSeconds: number
}
```

In `DEFAULTS.engine`:
```typescript
  engine: { pikafishPath: null, multipv: 5, movetime: 500, clockInitialSeconds: 600, clockIncrementSeconds: 5 } as EngineCfg,
```

- [ ] **Step 2: Add clock validation**

In `server/src/config/validate.ts`, add to the `engine` schema:
```typescript
  engine: {
    pikafishPath: (v) => (typeof v === 'string' ? v : v === null ? null : undefined),
    multipv: intRange(1, 10),
    movetime: intRange(50, 5000),
    clockInitialSeconds: intRange(30, 3600),
    clockIncrementSeconds: intRange(0, 60),
  },
```

- [ ] **Step 3: Run tests and commit**

```bash
cd /Users/miaoma/Downloads/围观象棋 && npx vitest run server/src/config/validate.test.ts
git add server/src/config/defaults.ts server/src/config/validate.ts
git commit -m "feat: add clock config to EngineCfg"
```

---

### Task 2: Add ClockState management to GameSession

**Files:**
- Modify: `server/src/session/game-session.ts`

- [ ] **Step 1: Add ClockState interface and Maps to GameSession class**

After the existing `private lastHumanBlunder` map (line 103), add:
```typescript
  /** 每局棋钟状态 */
  private clockStates = new Map<number, { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null; startedAt: number | null }>()
```

- [ ] **Step 2: Initialize clock state in newGame()**

After `this.noCapturePlies.set(id, noCapture)` in `newGame()`, add:
```typescript
    const engineCfg = this.deps.cfg.getEngineParams()
    this.clockStates.set(id, {
      redRemaining: engineCfg.clockInitialSeconds * 1000,
      blackRemaining: engineCfg.clockInitialSeconds * 1000,
      activeSide: null,
      startedAt: null,
    })
```

- [ ] **Step 3: Start clock when human's turn begins**

In the `playHumanMove` method (find where AI move is written and human move was processed), after writing moves to DB and computing the stimulus, add clock transition logic at the correct point. Read the `playHumanMove` method to find the exact insertion point.

Add this logic after the human move is written but before returning:
```typescript
    const clock = this.clockStates.get(gameId)!
    // AI just moved, now it's human's turn — start human's clock
    const humanSide = this.humanSides.get(gameId)!
    clock.activeSide = humanSide
    clock.startedAt = Date.now()
```

- [ ] **Step 4: Pause clock when human moves**

At the beginning of `playHumanMove` (before engine analysis), pause the clock and add increment:
```typescript
    const clock = this.clockStates.get(gameId)!
    if (clock?.activeSide !== null && clock?.startedAt !== null) {
      const elapsed = Date.now() - clock.startedAt
      if (clock.activeSide === 'red') clock.redRemaining -= elapsed
      else clock.blackRemaining -= elapsed
      // Add increment
      const inc = this.deps.cfg.getEngineParams().clockIncrementSeconds * 1000
      if (clock.activeSide === 'red') clock.redRemaining += inc
      else clock.blackRemaining += inc
      clock.activeSide = null
      clock.startedAt = null
    }
```

- [ ] **Step 5: Add timeout check method**

Add a new public method:
```typescript
  checkClockTimeout(gameId: number): boolean {
    const clock = this.clockStates.get(gameId)
    if (!clock || clock.activeSide === null || clock.startedAt === null) return false
    const elapsed = Date.now() - clock.startedAt
    const remaining = clock.activeSide === 'red'
      ? clock.redRemaining - elapsed
      : clock.blackRemaining - elapsed
    return remaining <= 0
  }

  getClockState(gameId: number) {
    const clock = this.clockStates.get(gameId)
    if (!clock) return null
    let red = clock.redRemaining
    let black = clock.blackRemaining
    if (clock.activeSide === 'red' && clock.startedAt !== null) {
      red -= Date.now() - clock.startedAt
    } else if (clock.activeSide === 'black' && clock.startedAt !== null) {
      black -= Date.now() - clock.startedAt
    }
    return { redRemaining: Math.max(0, red), blackRemaining: Math.max(0, black), activeSide: clock.activeSide }
  }

  pauseClock(gameId: number): void {
    const clock = this.clockStates.get(gameId)
    if (!clock || clock.activeSide === null || clock.startedAt === null) return
    const elapsed = Date.now() - clock.startedAt
    if (clock.activeSide === 'red') clock.redRemaining -= elapsed
    else clock.blackRemaining -= elapsed
    clock.activeSide = null
    clock.startedAt = null
  }
```

- [ ] **Step 6: Clean up clock state in finish()**

In the existing `finish()` method, add:
```typescript
    this.clockStates.delete(gameId)
```

- [ ] **Step 7: Run existing tests to verify no regression**

```bash
cd /Users/miaoma/Downloads/围观象棋 && npx vitest run server/src/session/game-session.test.ts
```

- [ ] **Step 8: Commit**

```bash
git add server/src/session/game-session.ts
git commit -m "feat: add clock state management to GameSession"
```

---

### Task 3: Add resign/draw/undo to ws-server message handling

**Files:**
- Modify: `server/src/ws-server.ts`
- Modify: `server/src/session/game-session.ts`

- [ ] **Step 1: Add resign and undo methods to GameSession**

In `server/src/session/game-session.ts`, add these public methods:

```typescript
  undoLastMoves(gameId: number): { success: boolean; remaining: number; fen: string } | { success: false } {
    this.ensureLoaded(gameId)
    const pos = this.positions.get(gameId)
    if (!pos) return { success: false }
    const mode = this.modes.get(gameId)
    if (mode !== 'coach') return { success: false }

    const moves = this.deps.repo.getMoves(gameId)
    if (moves.length < 2) return { success: false }

    // 撤回人类最后一步 + AI 回应
    const toRemove = moves.slice(-2)
    for (const m of toRemove) this.deps.repo.deleteLastMove(gameId)

    // 重建内存状态
    const g = this.deps.repo.getGame(gameId)!
    let newPos = this.deps.makePosition(g.startFen)
    const remaining = this.deps.repo.getMoves(gameId)
    for (const m of remaining) {
      newPos = newPos.applyMove(m.move)
    }
    this.positions.set(gameId, newPos)

    // 更新 prevRedCp
    const prevAi = remaining.filter(m => m.byAi).pop()
    this.prevRedCp.set(gameId, prevAi?.scoreCp ?? null)

    // 跟踪撤回次数(存在 ws-server 层)
    return { success: true, remaining: 0, fen: newPos.fen() }
  }

  resign(gameId: number): { success: boolean; result: string } {
    this.ensureLoaded(gameId)
    const humanSide = this.humanSides.get(gameId)
    if (!humanSide) return { success: false }
    const result = humanSide === 'red' ? 'black' : 'red'
    this.deps.repo.finishGame(gameId, this.deps.clock(), result as Side | 'draw')
    return { success: true, result }
  }
```

- [ ] **Step 2: Add deleteLastMove to GamesRepo**

In `server/src/store/games-repo.ts`, add:
```typescript
  deleteLastMove(gameId: number): void {
    this.db.prepare('DELETE FROM moves WHERE id = (SELECT id FROM moves WHERE game_id = ? ORDER BY ply DESC LIMIT 1)').run(gameId)
  }
```

- [ ] **Step 3: Add draw_offer handling**

In `server/src/session/game-session.ts`, add:
```typescript
  offerDraw(gameId: number): { accepted: boolean } {
    this.ensureLoaded(gameId)
    const mode = this.modes.get(gameId)
    const prob = mode === 'coach' ? 0.8 : 0.6
    const accepted = Math.random() < prob
    if (accepted) {
      this.deps.repo.finishGame(gameId, this.deps.clock(), 'draw')
    }
    return { accepted }
  }
```

- [ ] **Step 4: Wire up WS message handlers in ws-server.ts**

In the `socket.on('message', ...)` handler in `server/src/ws-server.ts`, add cases in the message type switch (after existing cases):

```typescript
        } else if (msg.type === 'resign') {
          const gid = msg.gameId as number
          session.resign(gid)
          // 发送 update 消息告知游戏结束
          const pos = (session as any).positions?.get(gid)
          const fen = pos ? pos.fen() : ''
          socket.send(JSON.stringify({ type: 'update', aiMove: null, fen, over: true, result: 'black' }))
          cleanupFinishedGame(gid)
          void reflectGame(gid).catch(() => {})
        } else if (msg.type === 'draw_offer') {
          const gid = msg.gameId as number
          const { accepted } = session.offerDraw(gid)
          socket.send(JSON.stringify({ type: 'draw_response', gameId: gid, accepted }))
          if (accepted) {
            const pos = (session as any).positions?.get(gid)
            const fen = pos ? pos.fen() : ''
            socket.send(JSON.stringify({ type: 'update', aiMove: null, fen, over: true, result: 'draw' }))
            cleanupFinishedGame(gid)
            void reflectGame(gid).catch(() => {})
          }
        } else if (msg.type === 'undo') {
          const gid = msg.gameId as number
          const result = session.undoLastMoves(gid)
          if (result.success) {
            const update = { type: 'undo_result' as const, gameId: gid, success: true, fen: result.fen }
            socket.send(JSON.stringify(update))
          } else {
            socket.send(JSON.stringify({ type: 'undo_result', gameId: gid, success: false }))
          }
```

- [ ] **Step 5: Add clockState to update messages**

In the `update` message sent after AI moves, add clockState. Find where `socket.send(JSON.stringify({ type: 'update', ...result }))` is called and add the clock:
```typescript
  const clockState = session.getClockState(gameId)
  socket.send(JSON.stringify({ type: 'update', ...result, clockState }))
```

Do the same for `aiFirstMove` response.

- [ ] **Step 6: Commit**

```bash
git add server/src/ws-server.ts server/src/session/game-session.ts server/src/store/games-repo.ts
git commit -m "feat: add resign/draw/undo WS message handling with clock state"
```

---

### Task 4: Add /legal-moves HTTP endpoint

**Files:**
- Modify: `server/src/ws-server.ts`

- [ ] **Step 1: Add the endpoint after existing HTTP routes**

In `server/src/ws-server.ts`, add after the `/tts` handler:
```typescript
  // ── 合法走法查询 ─────────────────────────────────────────────────────────────
  app.get('/legal-moves', async (req, reply) => {
    const query = req.query as { fen?: string; square?: string }
    const fen = String(query.fen ?? '')
    const square = String(query.square ?? '')
    if (!fen || !square || square.length !== 2) {
      return reply.code(400).send({ error: 'fen 和 square 参数必填, square 为 2 字符坐标如 e1' })
    }
    try {
      const pos = Position.fromFen(fen) as any
      const allMoves = pos.legalMoves() as string[]
      // 过滤出从 square 出发的走法
      const squares = allMoves
        .filter((m: string) => m.startsWith(square))
        .map((m: string) => m.slice(2, 4)) // 提取目标坐标
      return { squares }
    } catch (e) {
      return reply.code(400).send({ error: 'FEN 解析失败' })
    }
  })
```

Make sure `Position` is imported at the top of the file (it already is: `import { Position } from './rules/position.js'`).

- [ ] **Step 2: Commit**

```bash
git add server/src/ws-server.ts
git commit -m "feat: add /legal-moves endpoint for move indicators"
```

---

### Task 5: Update Board component (orientation, animation, legalMoves, preMove)

**Files:**
- Modify: `web/src/board/Board.tsx`

Add these new props and features:

- [ ] **Step 1: Add new BoardProps fields**

Replace the `BoardProps` interface:
```typescript
export interface BoardProps {
  fen: string
  onMove: (move: string) => void
  size?: number
  lastMove?: string | null
  disabled?: boolean
  orientation?: 'red' | 'black'
  /** 合法目标格列表(Pikafish 坐标),点击棋子后显示圆点 */
  legalSquares?: string[]
  /** 预走的 from/to (Pikafish 坐标),半透明显示 */
  preMove?: { from: string; to: string } | null
}
```

- [ ] **Step 2: Add orientation support**

Change `boardOrientation="white"` to:
```typescript
boardOrientation={orientation === 'black' ? 'black' : 'white'}
```

- [ ] **Step 3: Add legal move dot rendering**

In `squareStyles` construction, add after the `selectedSquare` block:
```typescript
  // 合法走法提示圆点
  if (legalSquares && legalSquares.length > 0) {
    for (const pikaSq of legalSquares) {
      const sq = pikafishToSquare(pikaSq)
      squareStyles[sq] = {
        background: 'radial-gradient(rgba(0,180,80,0.55) 20%, transparent 25%)',
        borderRadius: '50%',
      }
    }
  }
```

- [ ] **Step 4: Add preMove visual**

In `squareStyles`, add after legal squares:
```typescript
  // 预走显示
  if (preMove) {
    const fromSq = pikafishToSquare(preMove.from)
    const toSq = pikafishToSquare(preMove.to)
    squareStyles[fromSq] = { background: 'rgba(255,200,0,0.25)', outline: '3px dashed rgba(255,180,0,0.6)' }
    squareStyles[toSq] = { background: 'rgba(255,200,0,0.15)', outline: '3px dashed rgba(255,180,0,0.4)' }
  }
```

- [ ] **Step 5: Add animationDuration prop**

Add `animationDuration={300}` to `<Chessboard>` props.

- [ ] **Step 6: Commit**

```bash
git add web/src/board/Board.tsx
git commit -m "feat: add orientation, legal moves, preMove, animation to Board"
```

---

### Task 6: Create MoveList component

**Files:**
- Create: `web/src/board/MoveList.tsx`

- [ ] **Step 1: Write the component**

```typescript
import { useEffect } from 'react'
import { color, fontSize, font, radius, space } from '../ui/theme.js'

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
            >
              {row.red ?? ''}
            </span>
            <span
              style={{ ...styles.moveCell, ...(currentPly === blackPly ? styles.activeMove : {}) }}
              onClick={() => onNavigate(blackPly)}
            >
              {row.black ?? ''}
            </span>
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
    border: `1px solid ${color.line}`,
    borderRadius: radius.md,
    padding: space.sm,
    background: color.surface,
  },
  empty: {
    color: color.muted,
    fontSize: fontSize.sm,
    textAlign: 'center',
    padding: space.md,
  },
  row: {
    display: 'flex',
    gap: 4,
    padding: '2px 6px',
    borderRadius: 4,
    fontSize: fontSize.sm,
    fontFamily: font.mono,
  },
  activeRow: {
    background: color.accentSoft,
  },
  plyNum: {
    width: 32,
    color: color.muted,
    textAlign: 'right',
    flexShrink: 0,
  },
  moveCell: {
    flex: 1,
    cursor: 'pointer',
    padding: '0 4px',
    borderRadius: 3,
  },
  activeMove: {
    background: color.accent,
    color: '#fff',
    fontWeight: 600,
  },
}
```

Check that `color`, `fontSize`, `font`, `radius`, `space` are all exported from `../ui/theme.js`. If `font.mono` isn't available, use `'monospace'` as fallback.

- [ ] **Step 2: Commit**

```bash
git add web/src/board/MoveList.tsx
git commit -m "feat: add MoveList component with keyboard navigation"
```

---

### Task 7: Update ws-client types for new messages

**Files:**
- Modify: `web/src/api/ws-client.ts`

- [ ] **Step 1: Add new message types to ServerMsg union**

```typescript
export type ServerMsg =
  | { type: 'started'; gameId: number }
  | { type: 'update'; aiMove: string | null; fen: string; over: boolean; result?: 'red' | 'black' | 'draw'; clockState?: { redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null } }
  | { type: 'error'; message: string }
  | { type: 'chat'; gameId: number; personaId: string; text: string; addressee: string; ts: string }
  | { type: 'draw_response'; gameId: number; accepted: boolean }
  | { type: 'undo_result'; gameId: number; success: boolean; fen?: string }
```

- [ ] **Step 2: Commit**

```bash
git add web/src/api/ws-client.ts
git commit -m "feat: add draw_response and undo_result to ws-client types"
```

---

### Task 8: Integrate all features into PlayPage

**Files:**
- Modify: `web/src/pages/PlayPage.tsx`

This is the largest task. Add clock display, action buttons (resign/draw/undo), MoveList, legal moves fetching, preMove state, plyIndex navigation, board orientation.

- [ ] **Step 1: Add new state variables**

After the existing `useState` declarations (around line 30), add:
```typescript
  const [plyIndex, setPlyIndex] = useState(0) // 0 = 开局画面
  const [moves, setMoves] = useState<{ ply: number; move: string; side: 'red' | 'black' }[]>([])
  const [undoRemaining, setUndoRemaining] = useState(3)
  const [clockState, setClockState] = useState<{ redRemaining: number; blackRemaining: number; activeSide: 'red' | 'black' | null } | null>(null)
  const [preMove, setPreMove] = useState<{ from: string; to: string } | null>(null)
  const [legalSquares, setLegalSquares] = useState<string[]>([])
  const [flipped, setFlipped] = useState(false)
```

- [ ] **Step 2: Update handleServerMsg to handle new message types and track moves/clock**

In `handleServerMsg`, add these:

In the `'update'` case, after existing logic, add:
```typescript
      if (msg.clockState) setClockState(msg.clockState)
      // Track moves for MoveList (stimulus.moveZh is already in the message flow)
      // We'll get moves from the update's aiMove field
      if (msg.aiMove) {
        setMoves(prev => {
          const ply = prev.length + 1
          const side = ply % 2 === 1 ? 'red' : 'black'
          return [...prev, { ply, move: msg.aiMove!, side }]
        })
        setPlyIndex(prev => prev + 1)
      }
```

Add new message type handlers after the `'chat'` case:
```typescript
    } else if (msg.type === 'draw_response') {
      alert(msg.accepted ? 'AI 接受和棋！' : 'AI 拒绝和棋')
    } else if (msg.type === 'undo_result') {
      if (msg.success && msg.fen) {
        setFen(msg.fen)
        setFenKey(k => k + 1)
        setUndoRemaining(prev => prev - 1)
        // Remove last 2 moves from move list
        setMoves(prev => prev.slice(0, -2))
        setPlyIndex(prev => Math.max(0, prev - 2))
      } else {
        alert('无法悔棋（可能走法太少或非陪练模式）')
      }
```

- [ ] **Step 3: Add clock display UI**

Add a new component section in the sidebar (between the status card and the primary action button). Add a `ClockDisplay` inline or as a function:

```typescript
  function renderClock() {
    if (!clockState) return null
    const format = (ms: number) => {
      const totalSec = Math.max(0, Math.floor(ms / 1000))
      const min = Math.floor(totalSec / 60)
      const sec = totalSec % 60
      return `${min}:${String(sec).padStart(2, '0')}`
    }
    const isRedActive = clockState.activeSide === 'red'
    const isBlackActive = clockState.activeSide === 'black'
    const redLow = clockState.redRemaining < 30000
    const blackLow = clockState.blackRemaining < 30000
    return (
      <div style={styles.clockRow}>
        <div style={{ ...styles.clockBox, ...(isRedActive ? styles.clockActive : {}), ...(redLow ? styles.clockLow : {}) }}>
          <span style={styles.clockLabel}>红方</span>
          <span style={styles.clockTime}>{format(clockState.redRemaining)}</span>
        </div>
        <div style={{ ...styles.clockBox, ...(isBlackActive ? styles.clockActive : {}), ...(blackLow ? styles.clockLow : {}) }}>
          <span style={styles.clockLabel}>黑方</span>
          <span style={styles.clockTime}>{format(clockState.blackRemaining)}</span>
        </div>
      </div>
    )
  }
```

Add to the clock refresh with `useEffect`:
```typescript
  useEffect(() => {
    if (!clockState || clockState.activeSide === null) return
    const interval = setInterval(() => {
      setClockState(prev => {
        if (!prev || prev.activeSide === null) return prev
        const elapsed = 100 // approximate refresh
        if (prev.activeSide === 'red') return { ...prev, redRemaining: prev.redRemaining - 100 }
        return { ...prev, blackRemaining: prev.blackRemaining - 100 }
      })
    }, 100)
    return () => clearInterval(interval)
  }, [clockState?.activeSide])
```

- [ ] **Step 4: Add action buttons (resign/draw/undo)**

Add these buttons near the existing primary action buttons in the sidebar:

```typescript
      {/* 对局动作按钮 */}
      {status === 'playing' && gameId !== null && (
        <div style={styles.actionRow}>
          <button style={styles.actionBtn} onClick={() => { wsRef.current?.send({ type: 'resign', gameId }) }}>认输</button>
          <button style={styles.actionBtn} onClick={() => { wsRef.current?.send({ type: 'draw_offer', gameId }) }}>提和</button>
          {mode === 'coach' && (
            <button
              style={{ ...styles.actionBtn, ...(undoRemaining <= 0 ? { opacity: 0.4 } : {}) }}
              onClick={() => { if (undoRemaining > 0) wsRef.current?.send({ type: 'undo', gameId }) }}
              disabled={undoRemaining <= 0}
            >
              悔棋({undoRemaining})
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 5: Add board orientation toggle**

Add a flip button near the board and pass orientation to Board:
```typescript
  const boardOrientation = (side === 'black' && !flipped) || (side === 'red' && flipped) ? 'black' : 'red'
```

In the board section, add a flip button:
```typescript
  <button style={styles.flipBtn} onClick={() => setFlipped(f => !f)} aria-label="翻转棋盘">↻ 翻转</button>
```

Pass orientation to Board:
```typescript
  <Board
    key={fenKey}
    fen={fen}
    onMove={handleMove}
    size={boardSize}
    lastMove={lastAiMove}
    disabled={awaitingAi || status !== 'playing' || plyIndex < moves.length}
    orientation={boardOrientation}
    legalSquares={legalSquares}
    preMove={preMove}
  />
```

- [ ] **Step 6: Handle legal moves fetching**

Add a callback for when user clicks a piece in PlayPage:
```typescript
  async function handleSquareSelect(square: string) {
    // Fetch legal moves for this square
    try {
      const fenEncoded = encodeURIComponent(fen)
      const resp = await fetch(`http://localhost:3410/legal-moves?fen=${fenEncoded}&square=${square}`)
      if (resp.ok) {
        const data = await resp.json() as { squares: string[] }
        setLegalSquares(data.squares)
      }
    } catch {
      setLegalSquares([])
    }
  }
```

But wait — Board currently doesn't expose a square select callback. We need to add one. Let me add a `onSquareSelect` prop to Board.

Actually, looking at the current Board code, `handleSquareClick` already fires when a square is clicked. We can modify it to call an optional `onSquareSelect` callback on first click.

Modify Board's `handleSquareClick`:
```typescript
  function handleSquareClick(square: Square): void {
    if (disabled) return
    if (selectedSquare === null) {
      setSelectedSquare(square)
      onSquareSelect?.(squareToPikafish(square))
    } else {
      if (selectedSquare !== square) {
        const from = squareToPikafish(selectedSquare)
        const to = squareToPikafish(square)
        onMove(from + to)
      }
      setSelectedSquare(null)
      setLegalSquares([])
    }
  }
```

Add `onSquareSelect` to BoardProps (in Task 5 step 1).

- [ ] **Step 7: Handle pre-move in humanlike mode**

In `handleMove`, when `status !== 'playing'` (AI thinking) and mode is humanlike:
```typescript
  function handleMove(move: string) {
    if (status !== 'playing' || gameId === null) {
      // Pre-move during AI thinking
      if (awaitingAi && mode === 'humanlike') {
        setPreMove({ from: move.slice(0, 2), to: move.slice(2, 4) })
      }
      return
    }
    wsRef.current?.send({ type: 'move', gameId, move })
    setAwaitingAi(true)
    setPreMove(null)
    setLegalSquares([])
    setStatusError(false)
    setStatusMsg(`您走了 ${move}，AI 思考中…`)
  }
```

In `handleServerMsg` for the `'update'` case, after AI responds, execute preMove if set:
```typescript
      // Execute pre-move if set
      setPreMove(null)
      setAwaitingAi(false)
```

Actually let me handle preMove execution when AI responds. After `setAwaitingAi(false)` in the update case:
```typescript
      if (preMove && msg.fen) {
        // Validate preMove against the new position
        // For now, just send it — let server validate
        const preMoveStr = preMove.from + preMove.to
        setPreMove(null)
        // Schedule the move slightly after state updates
        setTimeout(() => {
          if (gameId !== null && wsRef.current) {
            wsRef.current.send({ type: 'move', gameId, move: preMoveStr })
          }
        }, 50)
      }
```

- [ ] **Step 8: Add MoveList to the layout**

Add MoveList between the board and the chat panel:
```typescript
  <div style={styles.moveListCol}>
    <MoveList moves={moves} currentPly={plyIndex} onNavigate={setPlyIndex} />
  </div>
```

When navigating to historical ply, set board FEN to that move's FEN. We need to store FEN per move. Update the moves state:
```typescript
  type MoveWithFen = { ply: number; move: string; side: 'red' | 'black'; fen: string }
  const [wMoves, setWMoves] = useState<MoveWithFen[]>([])
```

In the update handler, when tracking moves:
```typescript
      if (msg.aiMove && msg.fen) {
        setWMoves(prev => {
          const ply = prev.length + 1
          const side = ply % 2 === 1 ? 'red' : 'black'
          return [...prev, { ply, move: msg.aiMove!, side, fen: msg.fen }]
        })
        setPlyIndex(prev => prev + 1)
      }
```

When navigating, look up fen from wMoves. When plyIndex is set to a historical move, update fen from the move data.

This is getting complex. Let me simplify: only track moves that the human makes, and store fen per move for navigation. The AI moves are in the update message.

Actually, looking at the current data flow, the simplest approach is: in the `update` handler, we get `msg.fen` which is the position after AI's move. For the MoveList we need to display both human and AI moves. Currently the stimulus has `moveZh` for description.

Let me simplify the MoveList to receive data from a simpler source. Instead of tracking every move separately, let's just track the move descriptions from stimulus:

Simplified approach for Phase 1:
- Store an array of `{ ply: number, moveZh: string, side: string, fen: string }` 
- Human moves: capture before sending to server (we know the move string + current FEN)
- AI moves: from `update` message (has aiMove + fen)

```typescript
  const [moveEntries, setMoveEntries] = useState<{ ply: number; moveStr: string; side: 'red' | 'black'; fen: string }[]>([])
```

In `handleMove`, before sending:
```typescript
  function handleMove(move: string) {
    // ...
    const humanSide = side
    setMoveEntries(prev => {
      const ply = prev.length + 1
      return [...prev, { ply, moveStr: move, side: humanSide, fen: '' }] // fen will be filled by server response
    })
    wsRef.current?.send({ type: 'move', gameId, move })
    // ...
  }
```

In `update` handler:
```typescript
      if (msg.aiMove && msg.fen) {
        setMoveEntries(prev => {
          const ply = prev.length + 1
          // Update the last entry (human move) with fen if it's still empty
          const updated = prev.map(e => e.fen === '' ? { ...e, fen: msg.fen } : e)
          return [...updated, { ply, moveStr: msg.aiMove!, side: side === 'red' ? 'black' : 'red', fen: msg.fen }]
        })
        setPlyIndex(prev => prev + 2)
      }
```

This is getting too complex for the plan. Let me simplify the MoveList to just take move strings and ply numbers, and handle FEN navigation separately with a simpler data structure.

For the plan, let me use a straightforward approach:

**MoveList receives**: `MoveEntry[] = { ply: number, move: string, side: 'red' | 'black' }[]`

**PlayPage tracks**: `fenHistory: string[]` indexed by ply (fenHistory[0] = startFEN, fenHistory[1] = after ply 1, etc.)

**Navigation**: `onNavigate(ply)` → look up FEN from fenHistory[ply], set Board to display that FEN, disable board when ply < latest.

Let me rewrite the PlayPage integration more cleanly for the plan. Actually, this plan is getting extremely long. Let me focus on the key steps and consolidate.

- [ ] **Step 2 (revised): Track moves and FEN history in update handler**

In `handleServerMsg`'s `'update'` case, add:
```typescript
      // Track move history
      setFenHistory(prev => {
        const next = [...prev, msg.fen]
        // Keep last 200 entries max
        if (next.length > 200) next.shift()
        return next
      })
```

And human moves tracked via a separate mechanism:

```typescript
  const [moveHistory, setMoveHistory] = useState<{ply:number;move:string;side:'red'|'black'}[]>([])
  const [fenHistory, setFenHistory] = useState<string[]>([START_FEN])
```

In `handleMove` (before sending):
```typescript
    setMoveHistory(prev => [...prev, { ply: prev.length + 1, move, side }])
```

In update handler:
```typescript
      if (msg.aiMove) {
        setMoveHistory(prev => [...prev, { ply: prev.length + 1, move: msg.aiMove!, side: side === 'red' ? 'black' : 'red' }])
      }
```

- [ ] **Step 9: Reset state on new game**

In `handleStart` and `handleRestart`, reset:
```typescript
    setMoveHistory([])
    setFenHistory([START_FEN])
    setPlyIndex(0)
    setUndoRemaining(3)
    setClockState(null)
    setPreMove(null)
    setLegalSquares([])
```

- [ ] **Step 10: Add CSS styles and commit**

Add CSS styles for `clockRow`, `clockBox`, `clockActive`, `clockLow`, `clockLabel`, `clockTime`, `actionRow`, `actionBtn`, `flipBtn`, `moveListCol` to the styles object at the bottom of the file.

Commit:
```bash
git add web/src/pages/PlayPage.tsx
git commit -m "feat: integrate clock, actions, MoveList, legalMoves, preMove into PlayPage"
```

---

### Task 9: Full test run and final commit

- [ ] **Step 1: Run all tests**

```bash
cd /Users/miaoma/Downloads/围观象棋 && npm -w server test && npm -w web run typecheck
```

- [ ] **Step 2: Fix any test failures or type errors**

- [ ] **Step 3: Final commit if any fixes needed**

```bash
git add -A && git commit -m "fix: test fixes for gameplay enhancements"
```
