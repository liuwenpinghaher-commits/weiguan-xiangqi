import { useEffect, useRef, useState } from 'react'
import { connect, type ServerMsg } from '../api/ws-client.js'
import { Board } from '../board/Board.js'
import { ChatPanel, type ChatLine } from '../chat/ChatPanel.js'
import { cancelSpeech } from '../voice/browser-tts.js'
import { stopVoice } from '../voice/server-tts.js'
import { useIsNarrow } from '../hooks/use-viewport.js'
import { color, space, radius, fontSize, font, shadow, pill } from '../ui/theme.js'

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

type GameStatus = 'idle' | 'connecting' | 'waiting' | 'playing' | 'paused' | 'over' | 'error'
type GameMode = 'coach' | 'humanlike'
type GameResult = 'red' | 'black' | 'draw' | null
type HumanSide = 'red' | 'black'

export function PlayPage() {
  const [fen, setFen] = useState(START_FEN)
  const [fenKey, setFenKey] = useState(0) // 改变 key 强制 Board 重置（非法着回弹）
  const [status, setStatus] = useState<GameStatus>('idle')
  const statusRef = useRef<GameStatus>('idle')
  statusRef.current = status
  const [statusMsg, setStatusMsg] = useState('点「开始」开局')
  const [statusError, setStatusError] = useState(false) // 非法着法时用红字显示
  const [gameId, setGameId] = useState<number | null>(null)
  const [lastAiMove, setLastAiMove] = useState<string | null>(null)
  const [lines, setLines] = useState<ChatLine[]>([])
  const [mode, setMode] = useState<GameMode>('coach')
  const [side, setSide] = useState<HumanSide>('red') // 人类执哪方
  const [awaitingAi, setAwaitingAi] = useState(false) // AI 思考期间锁盘
  const [gameResult, setGameResult] = useState<GameResult>(null)
  const [isSparring, setIsSparring] = useState(false) // 是否从陪练局面起手

  const wsRef = useRef<ReturnType<typeof connect> | null>(null)
  const isNarrow = useIsNarrow()

  // 据 result 推导胜负文本（依据当前 side 状态）
  function resultText(result: GameResult): string {
    if (!result) return ''
    if (result === 'draw') return '和棋'
    return result === side ? '你赢了！' : '你输了'
  }

  // 共用消息处理函数，useEffect 与 handleRestart 均使用此函数
  function handleServerMsg(msg: ServerMsg) {
    if (msg.type === 'started') {
      setGameId(msg.gameId)
      setStatus('playing')
      // 黑方时等待 AI 先手 update 消息，此时先锁盘提示
      setStatusMsg('对局开始，请走棋')
      setStatusError(false)
    } else if (msg.type === 'update') {
      setFen(msg.fen)
      setFenKey(k => k + 1) // 刷新 key，确保 Board 与最新 fen 同步
      setLastAiMove(msg.aiMove)
      setAwaitingAi(false) // AI 已回应，解锁棋盘
      setStatusError(false)
      if (statusRef.current === 'paused') {
        // 暂停期间到达的 AI 落子:棋盘已更新,但保持暂停态,不抢回 playing/over
      } else if (msg.over) {
        const result = msg.result ?? null
        setGameResult(result)
        setStatus('over')
        const txt = resultText(result)
        setStatusMsg(txt ? `对局结束 — ${txt}` : '对局结束！')
      } else {
        setStatus('playing')
        setStatusMsg(msg.aiMove ? `AI 走了 ${msg.aiMove}，轮到您走` : '轮到您走棋')
      }
    } else if (msg.type === 'error') {
      // 非法着法或其他错误：解锁棋盘并强制回弹到当前合法 fen
      setAwaitingAi(false)
      setStatusError(true)
      setStatusMsg(`非法着法：${msg.message}`)
      // 修改 fenKey 强制 Board key 变化，使其重新 mount 并显示真实局面
      setFenKey(k => k + 1)
    } else if (msg.type === 'chat') {
      setLines(prev => [...prev, {
        personaId: msg.personaId,
        text: msg.text,
        addressee: msg.addressee,
        ts: msg.ts,
      }])
    }
  }

  // 创建 WebSocket 连接并发起新对局
  function startNewConnection(activeMode: GameMode = 'coach', activeSide: HumanSide = 'red', startFen: string = START_FEN) {
    wsRef.current?.close()
    const ws = connect(handleServerMsg, (s) => {
      if (s === 'reconnecting') {
        setStatus('connecting')
        setStatusMsg('连接断开，正在重连…')
        setStatusError(false)
      } else if (s === 'open') {
        // 重连成功后恢复 playing（保留 gameId，下一手发到同一 gameId 即可续局）
        setStatus((prev: GameStatus) => prev === 'connecting' ? 'playing' : prev)
        setStatusMsg((prev: string) => prev === '连接断开，正在重连…' ? '已重新连接，请继续走棋' : prev)
        setStatusError(false)
      } else if (s === 'closed') {
        setStatus('error')
        setStatusMsg('连接断开，请重新开始')
        setStatusError(false)
      } else if (s === 'error') {
        setStatus('error')
        setStatusMsg('连接出错，请检查网络后重试')
        setStatusError(false)
      }
    })
    wsRef.current = ws
    ws.send({ type: 'new', mode: activeMode, humanSide: activeSide, startFen })
    setStatus('waiting')
    setStatusMsg('正在创建对局...')
    return ws
  }

  useEffect(() => {
    // 检查是否有专项陪练局面（由 GrowthPage 写入 sessionStorage）
    const sparringFen = sessionStorage.getItem('weiguan_sparring_fen')
    const sparringSide = sessionStorage.getItem('weiguan_sparring_side') as HumanSide | null
    if (sparringFen) {
      // 清除避免下次仍沿用
      sessionStorage.removeItem('weiguan_sparring_fen')
      sessionStorage.removeItem('weiguan_sparring_side')
      const activeSide: HumanSide = sparringSide === 'black' ? 'black' : 'red'
      setSide(activeSide)
      setIsSparring(true)
      const ws = startNewConnection(mode, activeSide, sparringFen)
      return () => { ws.close() }
    }
    // 非陪练：进页不自动开局，等待用户点「开始」
    setStatus('idle')
    setStatusMsg('点「开始」开局')
    return () => { wsRef.current?.close() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleStart() {
    startNewConnection(mode, side)
  }

  function handlePause() {
    if (status !== 'playing' || gameId === null) return
    wsRef.current?.send({ type: 'pause', gameId })
    stopVoice()
    cancelSpeech()
    setStatus('paused')
    setStatusMsg('已暂停 — 点「继续」恢复')
    setStatusError(false)
  }

  function handleResume() {
    if (status !== 'paused' || gameId === null) return
    wsRef.current?.send({ type: 'resume', gameId })
    setStatus('playing')
    setStatusMsg('已继续，请走棋')
    setStatusError(false)
  }

  function handleMove(move: string) {
    if (status !== 'playing' || gameId === null) return
    wsRef.current?.send({ type: 'move', gameId, move })
    setAwaitingAi(true) // 等待 AI 响应，锁盘
    setStatusError(false)
    setStatusMsg(`您走了 ${move}，AI 思考中…`)
  }

  function handleRestart(activeMode?: GameMode, activeSide?: HumanSide) {
    cancelSpeech()
    setFen(START_FEN)
    setFenKey(k => k + 1)
    setGameId(null)
    setLastAiMove(null)
    setLines([])
    setStatus('connecting')
    setStatusMsg('正在连接服务器...')
    setAwaitingAi(false)
    setGameResult(null)
    setStatusError(false)
    setIsSparring(false) // 手动重开时取消陪练提示
    startNewConnection(activeMode ?? mode, activeSide ?? side)
  }

  function handleModeChange(newMode: GameMode) {
    setMode(newMode)
    if (status !== 'idle') handleRestart(newMode, side)
  }

  function handleSideChange(newSide: HumanSide) {
    setSide(newSide)
    if (status !== 'idle') handleRestart(mode, newSide)
  }

  // 窄屏下棋盘尺寸：视口宽度减边距，最大 460；宽屏 500
  const boardSize = isNarrow
    ? Math.min(typeof window !== 'undefined' ? window.innerWidth - 32 : 460, 460)
    : 500

  const resultTxt = resultText(gameResult)
  const canStart = status === 'idle' || status === 'over' || status === 'error'

  // 主操作按钮(开始/暂停/继续)——直播间左栏的醒目主入口
  const primaryAction = canStart ? (
    <button style={styles.primaryBtn} onClick={handleStart} aria-label="开始对局">▶ 开始对局</button>
  ) : status === 'playing' ? (
    <button style={styles.pauseBtn} onClick={handlePause} aria-label="暂停对局">⏸ 暂停</button>
  ) : status === 'paused' ? (
    <button style={styles.primaryBtn} onClick={handleResume} aria-label="继续对局">▶ 继续</button>
  ) : (
    <button style={{ ...styles.primaryBtn, opacity: 0.6 }} disabled aria-label="连接中">连接中…</button>
  )

  // 左栏:设置 + 状态 + 操作
  const sidebar = (
    <aside style={{ ...styles.rail, ...(isNarrow ? { width: '100%', maxWidth: 480 } : {}) }} aria-label="对局设置与控制">
      {isSparring && (
        <div style={styles.sparringBanner}>专项陪练：从你上次的失误局面开始</div>
      )}

      {/* 状态卡 */}
      <div style={styles.statusCard} aria-live="polite" aria-label="对局状态">
        <span style={statusError ? styles.statusTextError : styles.statusText}>{statusMsg}</span>
        <div style={styles.statusMeta}>
          {awaitingAi && !statusError && <span style={styles.thinkingBadge}>AI 思考中…</span>}
          {lastAiMove && !awaitingAi && <span style={styles.aiMove}>AI 上一手 {lastAiMove}</span>}
        </div>
      </div>

      {primaryAction}

      {/* 结果横幅 */}
      {status === 'over' && resultTxt && (
        <div style={resultTxt === '你赢了！' ? styles.resultWin : resultTxt === '和棋' ? styles.resultDraw : styles.resultLose}>
          {resultTxt}
        </div>
      )}

      {/* 对局设置 */}
      <div style={styles.settingsCard}>
        <div style={styles.settingsTitle}>对局设置</div>

        <div style={styles.settingRow}>
          <span style={styles.settingLabel}>模式</span>
          <div style={styles.pillGroup}>
            <button style={pill(mode === 'coach')} onClick={() => handleModeChange('coach')}
              title="AI 会带你、动态控盘，保持局面胶着让你跳一跳够得着"
              aria-label="切换为陪练模式" aria-pressed={mode === 'coach'}>陪练</button>
            <button style={pill(mode === 'humanlike')} onClick={() => handleModeChange('humanlike')}
              title="AI 像真人棋风，输赢自然，随机性中带有真实下法"
              aria-label="切换为拟人对手模式" aria-pressed={mode === 'humanlike'}>拟人对手</button>
          </div>
        </div>
        <p style={styles.settingHint}>{mode === 'coach' ? 'AI 会带你、动态控盘' : 'AI 像真人棋风，输赢自然'}</p>

        <div style={styles.settingRow}>
          <span style={styles.settingLabel}>执棋方</span>
          <div style={styles.pillGroup}>
            <button style={pill(side === 'red', color.red, '#fff')} onClick={() => handleSideChange('red')}
              title="执红先手" aria-label="执红先手" aria-pressed={side === 'red'}>执红（先手）</button>
            <button style={pill(side === 'black', color.black, '#fff')} onClick={() => handleSideChange('black')}
              title="执黑后手，AI 红方先走" aria-label="执黑后手" aria-pressed={side === 'black'}>执黑（后手）</button>
          </div>
        </div>
        <p style={styles.settingHint}>{side === 'red' ? '你执红先走' : 'AI 执红先走，你执黑'}</p>
        <p style={styles.settingHint}>切换执棋方或模式即刻重开新局</p>
      </div>

      {/* 次级操作 */}
      <button style={styles.restartBtn} onClick={() => handleRestart()} aria-label="重新开始新对局">重新开始</button>

      {status === 'over' && gameId !== null && (
        <>
          <div style={styles.afterLinks}>
            <a href={`#/review/${gameId}`} style={{ ...styles.linkBtn, ...styles.linkReview }}>查看复盘</a>
            <a href={`#/analysis/${gameId}`} style={{ ...styles.linkBtn, ...styles.linkAnalysis }}>分析本局</a>
            <a href={`#/training/${gameId}`} style={{ ...styles.linkBtn, ...styles.linkTraining }}>针对训练</a>
          </div>
          <p style={styles.diagnosedHint}>对局已自动诊断，可查看分析或进行针对训练</p>
        </>
      )}
      {status === 'over' && gameId === null && <span style={styles.overTag}>对局已结束</span>}

      <p style={styles.hint}>支持拖拽或点选走棋</p>
    </aside>
  )

  return (
    <div style={styles.page}>
      <div style={{ ...styles.studio, flexDirection: isNarrow ? 'column' : 'row', alignItems: isNarrow ? 'center' : 'flex-start' }}>
        {sidebar}

        <div style={styles.centerCol}>
          <div style={styles.boardWrapper}>
            <Board
              key={fenKey}
              fen={fen}
              onMove={handleMove}
              size={boardSize}
              lastMove={lastAiMove}
              disabled={awaitingAi || status !== 'playing'}
            />
          </div>
        </div>

        <div style={{ ...styles.chatCol, height: isNarrow ? 420 : boardSize, ...(isNarrow ? { width: '100%', maxWidth: 480 } : {}) }}>
          <ChatPanel
            key={gameId ?? 'idle'}
            lines={lines}
            onSay={(t) => { if (status === 'playing' && gameId !== null) wsRef.current?.send({ type: 'say', gameId, text: t }) }}
          />
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: 'calc(100dvh - 52px)',
    padding: `${space.xl}px ${space.lg}px`,
    background: color.bg,
    color: color.text,
    fontFamily: font.sans,
  },
  // 直播间三栏容器
  studio: {
    display: 'flex',
    gap: space.lg,
    alignItems: 'flex-start',
    justifyContent: 'center',
    maxWidth: 1180,
    margin: '0 auto',
    width: '100%',
  },
  rail: {
    width: 264,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    alignSelf: 'stretch',
  },
  centerCol: {
    flexShrink: 0,
    display: 'flex',
    justifyContent: 'center',
  },
  chatCol: {
    flex: 1,
    minWidth: 240,
    maxWidth: 380,
  },
  boardWrapper: {
    borderRadius: radius.md,
    overflow: 'hidden',
    boxShadow: shadow.raised,
  },
  // 状态卡
  statusCard: {
    background: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    padding: `${space.md}px ${space.lg}px`,
    display: 'flex',
    flexDirection: 'column',
    gap: space.xs,
  },
  statusText: { fontSize: fontSize.base, color: color.text },
  statusTextError: { fontSize: fontSize.base, color: color.danger, fontWeight: 600 },
  statusMeta: { display: 'flex', gap: space.sm, alignItems: 'center', flexWrap: 'wrap', minHeight: 18 },
  thinkingBadge: {
    fontSize: fontSize.xs, color: color.gold, background: color.goldSoft,
    padding: '2px 10px', borderRadius: radius.pill, border: `1px solid ${color.goldBorder}`,
  },
  aiMove: { fontSize: fontSize.sm, color: color.gold, fontFamily: font.mono },
  // 主操作按钮
  primaryBtn: {
    padding: '12px 20px', fontSize: fontSize.md, fontWeight: 700,
    background: color.gold, color: color.onGold, border: 'none',
    borderRadius: radius.md, cursor: 'pointer', width: '100%',
    transition: 'filter .15s', letterSpacing: '0.04em',
  },
  pauseBtn: {
    padding: '12px 20px', fontSize: fontSize.md, fontWeight: 700,
    background: color.surfaceAlt, color: color.text, border: `1px solid ${color.borderStrong}`,
    borderRadius: radius.md, cursor: 'pointer', width: '100%',
    transition: 'background .15s', letterSpacing: '0.04em',
  },
  restartBtn: {
    padding: '9px 20px', fontSize: fontSize.base, fontWeight: 600,
    background: color.surfaceAlt, color: color.textMuted, border: `1px solid ${color.border}`,
    borderRadius: radius.md, cursor: 'pointer', width: '100%',
  },
  // 设置卡
  settingsCard: {
    background: color.surface,
    border: `1px solid ${color.border}`,
    borderRadius: radius.lg,
    padding: `${space.md}px ${space.lg}px ${space.sm}px`,
  },
  settingsTitle: {
    fontSize: fontSize.sm, color: color.gold, fontWeight: 700,
    letterSpacing: '0.08em', marginBottom: space.sm,
  },
  settingRow: { display: 'flex', flexDirection: 'column', gap: space.xs, marginTop: space.sm },
  settingLabel: { fontSize: fontSize.sm, color: color.textMuted },
  pillGroup: { display: 'flex', gap: space.sm, flexWrap: 'wrap' },
  settingHint: { fontSize: fontSize.xs, color: color.textFaint, margin: '4px 0 0', fontStyle: 'italic' },
  // 结果横幅
  resultWin: {
    fontSize: fontSize.lg, fontWeight: 800, textAlign: 'center',
    color: color.gold, background: color.goldSoft, border: `2px solid ${color.gold}`,
    borderRadius: radius.md, padding: '10px', letterSpacing: '0.05em',
  },
  resultLose: {
    fontSize: fontSize.lg, fontWeight: 800, textAlign: 'center',
    color: color.danger, background: color.dangerSoft, border: `2px solid ${color.danger}`,
    borderRadius: radius.md, padding: '10px', letterSpacing: '0.05em',
  },
  resultDraw: {
    fontSize: fontSize.lg, fontWeight: 800, textAlign: 'center',
    color: color.textMuted, background: color.surfaceAlt, border: `2px solid ${color.borderStrong}`,
    borderRadius: radius.md, padding: '10px', letterSpacing: '0.05em',
  },
  // 结束后链接
  afterLinks: { display: 'flex', flexDirection: 'column', gap: space.sm },
  linkBtn: {
    padding: '9px 16px', fontSize: fontSize.base, fontWeight: 700,
    borderRadius: radius.md, textDecoration: 'none', textAlign: 'center', display: 'block',
  },
  linkReview: { background: color.gold, color: color.onGold },
  linkAnalysis: { background: color.info, color: '#fff' },
  linkTraining: { background: color.success, color: '#fff' },
  overTag: {
    padding: '8px 16px', background: color.goldSoft, color: color.gold,
    borderRadius: radius.md, fontWeight: 700, textAlign: 'center',
  },
  diagnosedHint: { marginTop: space.sm, fontSize: fontSize.xs, color: color.success, fontStyle: 'italic' },
  hint: { marginTop: space.sm, fontSize: fontSize.xs, color: color.textFaint, textAlign: 'center' },
  sparringBanner: {
    padding: '8px 14px', background: 'rgba(142,68,173,0.18)', border: '1px solid #8e44ad',
    borderRadius: radius.md, color: '#d7bde2', fontSize: fontSize.sm, fontWeight: 600,
  },
}
