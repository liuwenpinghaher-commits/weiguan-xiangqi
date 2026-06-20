import { useEffect, useRef, useState } from 'react'
import { connect, type ServerMsg } from '../api/ws-client.js'
import { Board } from '../board/Board.js'
import { ChatPanel, type ChatLine } from '../chat/ChatPanel.js'
import { cancelSpeech } from '../voice/browser-tts.js'

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

type GameStatus = 'connecting' | 'waiting' | 'playing' | 'over' | 'error'
type GameMode = 'coach' | 'humanlike'

export function PlayPage() {
  const [fen, setFen] = useState(START_FEN)
  const [status, setStatus] = useState<GameStatus>('connecting')
  const [statusMsg, setStatusMsg] = useState('正在连接服务器...')
  const [gameId, setGameId] = useState<number | null>(null)
  const [lastAiMove, setLastAiMove] = useState<string | null>(null)
  const [lines, setLines] = useState<ChatLine[]>([])
  const [mode, setMode] = useState<GameMode>('coach')

  const wsRef = useRef<ReturnType<typeof connect> | null>(null)

  // 共用消息处理函数,useEffect 与 handleRestart 均使用此函数
  function handleServerMsg(msg: ServerMsg) {
    if (msg.type === 'started') {
      setGameId(msg.gameId)
      setStatus('playing')
      setStatusMsg('对局开始，请走棋（红方先手）')
    } else if (msg.type === 'update') {
      setFen(msg.fen)
      setLastAiMove(msg.aiMove)
      if (msg.over) {
        setStatus('over')
        setStatusMsg('对局结束！')
      } else {
        setStatus('playing')
        setStatusMsg(msg.aiMove ? `AI 走了 ${msg.aiMove}，轮到您走` : '轮到您走棋')
      }
    } else if (msg.type === 'error') {
      setStatusMsg(`错误：${msg.message}`)
      // 不改变 status，让用户可以继续
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
  function startNewConnection(activeMode: GameMode = 'coach') {
    wsRef.current?.close()
    const ws = connect(handleServerMsg, (s) => {
      if (s === 'closed') {
        setStatus('error')
        setStatusMsg('连接断开，请刷新页面或重新开始')
      } else if (s === 'error') {
        setStatus('error')
        setStatusMsg('连接出错，请检查网络后重试')
      }
    })
    wsRef.current = ws
    ws.send({ type: 'new', mode: activeMode, humanSide: 'red', startFen: START_FEN })
    setStatus('waiting')
    setStatusMsg('正在创建对局...')
    return ws
  }

  useEffect(() => {
    setStatusMsg('正在连接服务器...')
    const ws = startNewConnection(mode)
    return () => {
      ws.close()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleMove(move: string) {
    if (status !== 'playing' || gameId === null) return
    wsRef.current?.send({ type: 'move', gameId, move })
    setStatusMsg(`您走了 ${move}，等待 AI 响应...`)
  }

  function handleRestart(activeMode?: GameMode) {
    cancelSpeech()
    setFen(START_FEN)
    setGameId(null)
    setLastAiMove(null)
    setLines([])
    setStatus('connecting')
    setStatusMsg('正在连接服务器...')
    startNewConnection(activeMode ?? mode)
  }

  function handleModeChange(newMode: GameMode) {
    setMode(newMode)
    handleRestart(newMode)
  }

  return (
    <div style={styles.page}>
      <h1 style={styles.title}>围观象棋</h1>

      <div style={styles.statusBar}>
        <span style={styles.statusText}>{statusMsg}</span>
        {lastAiMove && (
          <span style={styles.aiMove}>AI 上一手：{lastAiMove}</span>
        )}
      </div>

      <div style={styles.boardArea}>
        <div style={styles.boardWrapper}>
          <Board fen={fen} onMove={handleMove} />
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

      <div style={styles.controls}>
        <button style={styles.btn} onClick={() => handleRestart()}>
          重新开始
        </button>
        {status === 'over' && gameId !== null && (
          <a
            href={`#/review/${gameId}`}
            style={styles.reviewBtn}
          >
            查看复盘
          </a>
        )}
        {status === 'over' && gameId === null && (
          <span style={styles.overTag}>对局已结束</span>
        )}
      </div>

      <p style={styles.hint}>
        支持拖拽或点选走棋 · 红方执先 · 切换模式即刻重开新局
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
    gap: '24px',
    alignItems: 'center',
    marginBottom: '16px',
    padding: '10px 20px',
    background: 'rgba(255,255,255,0.08)',
    borderRadius: '8px',
    minWidth: '320px',
    justifyContent: 'center',
  },
  statusText: {
    fontSize: '0.95rem',
  },
  aiMove: {
    fontSize: '0.85rem',
    color: '#f5c518',
    fontFamily: 'monospace',
  },
  boardArea: {
    display: 'flex',
    flexDirection: 'row',
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
}
