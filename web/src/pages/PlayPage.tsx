import { useEffect, useRef, useState } from 'react'
import { connect, type ServerMsg } from '../api/ws-client.js'
import { Board } from '../board/Board.js'
import { ChatPanel, type ChatLine } from '../chat/ChatPanel.js'
import { cancelSpeech } from '../voice/browser-tts.js'
import { useIsNarrow } from '../hooks/use-viewport.js'

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

type GameStatus = 'connecting' | 'waiting' | 'playing' | 'over' | 'error'
type GameMode = 'coach' | 'humanlike'
type GameResult = 'red' | 'black' | 'draw' | null
type HumanSide = 'red' | 'black'

export function PlayPage() {
  const [fen, setFen] = useState(START_FEN)
  const [fenKey, setFenKey] = useState(0) // 改变 key 强制 Board 重置（非法着回弹）
  const [status, setStatus] = useState<GameStatus>('connecting')
  const [statusMsg, setStatusMsg] = useState('正在连接服务器...')
  const [statusError, setStatusError] = useState(false) // 非法着法时用红字显示
  const [gameId, setGameId] = useState<number | null>(null)
  const [lastAiMove, setLastAiMove] = useState<string | null>(null)
  const [lines, setLines] = useState<ChatLine[]>([])
  const [mode, setMode] = useState<GameMode>('coach')
  const [side, setSide] = useState<HumanSide>('red') // 人类执哪方
  const [awaitingAi, setAwaitingAi] = useState(false) // AI 思考期间锁盘
  const [gameResult, setGameResult] = useState<GameResult>(null)

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
      if (msg.over) {
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
  function startNewConnection(activeMode: GameMode = 'coach', activeSide: HumanSide = 'red') {
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
    ws.send({ type: 'new', mode: activeMode, humanSide: activeSide, startFen: START_FEN })
    setStatus('waiting')
    setStatusMsg('正在创建对局...')
    return ws
  }

  useEffect(() => {
    setStatusMsg('正在连接服务器...')
    const ws = startNewConnection(mode, side)
    return () => {
      ws.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

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
    startNewConnection(activeMode ?? mode, activeSide ?? side)
  }

  function handleModeChange(newMode: GameMode) {
    setMode(newMode)
    handleRestart(newMode, side)
  }

  function handleSideChange(newSide: HumanSide) {
    setSide(newSide)
    handleRestart(mode, newSide)
  }

  // 窄屏下棋盘尺寸：视口宽度减边距，最大 460
  const boardSize = isNarrow
    ? Math.min(typeof window !== 'undefined' ? window.innerWidth - 32 : 460, 460)
    : 480

  const resultTxt = resultText(gameResult)

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>围观象棋</h1>

      <div style={styles.statusBar}>
        <span style={statusError ? styles.statusTextError : styles.statusText}>
          {statusMsg}
        </span>
        {awaitingAi && !statusError && (
          <span style={styles.thinkingBadge}>AI 思考中…</span>
        )}
        {lastAiMove && !awaitingAi && (
          <span style={styles.aiMove}>AI 上一手：{lastAiMove}</span>
        )}
      </div>

      {/* 对局结束结果横幅 */}
      {status === 'over' && resultTxt && (
        <div style={resultTxt === '你赢了！' ? styles.resultWin : resultTxt === '和棋' ? styles.resultDraw : styles.resultLose}>
          {resultTxt}
        </div>
      )}

      <div style={{ ...styles.boardArea, flexDirection: isNarrow ? 'column' : 'row' }}>
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
        <ChatPanel
          lines={lines}
          onSay={(t) => wsRef.current?.send({ type: 'say', gameId, text: t })}
        />
      </div>

      <div style={styles.modeBar}>
        <span style={styles.modeLabel}>对局模式：</span>
        <button
          style={{ ...styles.modeBtn, ...(mode === 'coach' ? styles.modeBtnActive : {}) }}
          onClick={() => handleModeChange('coach')}
          title="AI 会带你、动态控盘，保持局面胶着让你跳一跳够得着"
        >
          陪练模式
        </button>
        <button
          style={{ ...styles.modeBtn, ...(mode === 'humanlike' ? styles.modeBtnActive : {}) }}
          onClick={() => handleModeChange('humanlike')}
          title="AI 像真人棋风，输赢自然，随机性中带有真实下法"
        >
          拟人对手
        </button>
        <span style={styles.modeHint}>
          {mode === 'coach'
            ? 'AI 会带你、动态控盘'
            : 'AI 像真人棋风，输赢自然'}
        </span>
      </div>

      <div style={styles.modeBar}>
        <span style={styles.modeLabel}>执棋方：</span>
        <button
          style={{ ...styles.modeBtn, ...(side === 'red' ? styles.modeBtnRedActive : {}) }}
          onClick={() => handleSideChange('red')}
          title="执红先手"
        >
          执红（先手）
        </button>
        <button
          style={{ ...styles.modeBtn, ...(side === 'black' ? styles.modeBtnBlackActive : {}) }}
          onClick={() => handleSideChange('black')}
          title="执黑后手，AI 红方先走"
        >
          执黑（后手）
        </button>
        <span style={styles.modeHint}>
          {side === 'red' ? '你执红先走' : 'AI 执红先走，你执黑'}
        </span>
      </div>

      <div style={styles.controls}>
        <button style={styles.btn} onClick={() => handleRestart()}>
          重新开始
        </button>
        {status === 'over' && gameId !== null && (
          <>
            <a href={`#/review/${gameId}`} style={styles.reviewBtn}>
              查看复盘
            </a>
            <a href={`#/analysis/${gameId}`} style={styles.analysisBtn}>
              分析本局
            </a>
            <a href={`#/training/${gameId}`} style={styles.trainingBtn}>
              针对训练
            </a>
          </>
        )}
        {status === 'over' && gameId === null && (
          <span style={styles.overTag}>对局已结束</span>
        )}
      </div>
      {status === 'over' && gameId !== null && (
        <p style={styles.diagnosedHint}>对局已自动诊断，可查看分析或进行针对训练</p>
      )}

      <p style={styles.hint}>
        支持拖拽或点选走棋 · 切换执棋方或模式即刻重开新局
      </p>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '24px 16px',
    background: '#1a1a2e',
    color: '#eee',
    fontFamily: '"Noto Serif SC", "Source Han Serif", serif',
  },
  title: {
    fontSize: '2rem',
    fontWeight: 700,
    margin: '0 0 16px',
    color: '#f5c518',
    letterSpacing: '0.1em',
  },
  statusBar: {
    display: 'flex',
    gap: '12px',
    alignItems: 'center',
    marginBottom: '12px',
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '8px',
    minWidth: '280px',
    justifyContent: 'center',
    flexWrap: 'wrap',
  },
  statusText: {
    fontSize: '0.95rem',
  },
  statusTextError: {
    fontSize: '0.95rem',
    color: '#ff5252',
    fontWeight: 600,
  },
  thinkingBadge: {
    fontSize: '0.82rem',
    color: '#f5c518',
    background: 'rgba(245,197,24,0.12)',
    padding: '2px 10px',
    borderRadius: '12px',
    border: '1px solid rgba(245,197,24,0.4)',
    animation: 'none',
  },
  aiMove: {
    fontSize: '0.85rem',
    color: '#f5c518',
    fontFamily: 'monospace',
  },
  // 结果横幅
  resultWin: {
    fontSize: '1.6rem',
    fontWeight: 800,
    color: '#f5c518',
    background: 'rgba(245,197,24,0.15)',
    border: '2px solid #f5c518',
    borderRadius: '10px',
    padding: '10px 40px',
    marginBottom: '14px',
    letterSpacing: '0.05em',
  },
  resultLose: {
    fontSize: '1.6rem',
    fontWeight: 800,
    color: '#ff6b6b',
    background: 'rgba(255,107,107,0.12)',
    border: '2px solid #ff6b6b',
    borderRadius: '10px',
    padding: '10px 40px',
    marginBottom: '14px',
    letterSpacing: '0.05em',
  },
  resultDraw: {
    fontSize: '1.6rem',
    fontWeight: 800,
    color: '#aaa',
    background: 'rgba(170,170,170,0.1)',
    border: '2px solid #888',
    borderRadius: '10px',
    padding: '10px 40px',
    marginBottom: '14px',
    letterSpacing: '0.05em',
  },
  boardArea: {
    display: 'flex',
    gap: '20px',
    alignItems: 'flex-start',
  },
  boardWrapper: {
    borderRadius: '8px',
    overflow: 'hidden',
    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
  },
  controls: {
    marginTop: '20px',
    display: 'flex',
    gap: '16px',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
  },
  btn: {
    padding: '10px 28px',
    fontSize: '1rem',
    background: '#c0392b',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 600,
  },
  reviewBtn: {
    padding: '10px 28px',
    fontSize: '1rem',
    background: '#f5c518',
    color: '#1a1a2e',
    borderRadius: '6px',
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-block',
  },
  overTag: {
    padding: '8px 16px',
    background: '#f5c518',
    color: '#1a1a2e',
    borderRadius: '6px',
    fontWeight: 700,
  },
  analysisBtn: {
    padding: '10px 28px',
    fontSize: '1rem',
    background: '#2980b9',
    color: '#fff',
    borderRadius: '6px',
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-block',
  },
  trainingBtn: {
    padding: '10px 28px',
    fontSize: '1rem',
    background: '#27ae60',
    color: '#fff',
    borderRadius: '6px',
    fontWeight: 700,
    textDecoration: 'none',
    display: 'inline-block',
  },
  diagnosedHint: {
    marginTop: '8px',
    fontSize: '0.82rem',
    color: '#8bc34a',
    fontStyle: 'italic' as const,
  },
  hint: {
    marginTop: '16px',
    fontSize: '0.8rem',
    color: '#888',
  },
  modeBar: {
    display: 'flex',
    gap: '10px',
    alignItems: 'center',
    marginBottom: '12px',
    marginTop: '16px',
    flexWrap: 'wrap' as const,
    justifyContent: 'center',
  },
  modeLabel: {
    fontSize: '0.9rem',
    color: '#aaa',
  },
  modeBtn: {
    padding: '6px 18px',
    fontSize: '0.9rem',
    background: 'rgba(255,255,255,0.1)',
    color: '#ccc',
    border: '1px solid rgba(255,255,255,0.2)',
    borderRadius: '20px',
    cursor: 'pointer',
    fontWeight: 500,
    transition: 'all 0.15s',
  },
  modeBtnActive: {
    background: '#f5c518',
    color: '#1a1a2e',
    border: '1px solid #f5c518',
    fontWeight: 700,
  },
  modeHint: {
    fontSize: '0.8rem',
    color: '#888',
    fontStyle: 'italic' as const,
  },
  modeBtnRedActive: {
    background: '#c0392b',
    color: '#fff',
    border: '1px solid #c0392b',
    fontWeight: 700,
  },
  modeBtnBlackActive: {
    background: '#333',
    color: '#fff',
    border: '1px solid #888',
    fontWeight: 700,
  },
}
