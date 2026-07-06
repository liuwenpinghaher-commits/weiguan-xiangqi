import { useEffect, useRef, useState } from 'react'
import { connect, type ServerMsg } from '../api/ws-client.js'
import { HTTP_BASE } from '../api/config.js'
import { Board } from '../board/Board.js'
import { MoveList } from '../board/MoveList.js'
import { ChatPanel, type ChatLine } from '../chat/ChatPanel.js'
import { cancelSpeech } from '../voice/browser-tts.js'
import { stopVoice, dropQueued } from '../voice/server-tts.js'
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
  const [lastAiMove, setLastAiMove] = useState<string | null>(null) // UCI,供棋盘高亮 lastMove
  const [lastAiMoveZh, setLastAiMoveZh] = useState<string | null>(null) // 中文注记,供文案展示
  const [lines, setLines] = useState<ChatLine[]>([])
  const [mode, setMode] = useState<GameMode>('coach')
  const [side, setSide] = useState<HumanSide>('red') // 人类执哪方
  const [awaitingAi, setAwaitingAi] = useState(false) // AI 思考期间锁盘
  const [gameResult, setGameResult] = useState<GameResult>(null)
  const [isSparring, setIsSparring] = useState(false) // 是否从陪练局面起手
  const [spectatorsOn, setSpectatorsOn] = useState(true) // 观众席(弹幕+语音)开关
  const [moveHistory, setMoveHistory] = useState<{ply:number;move:string;side:'red'|'black';zh?:string}[]>([])
  const [fenHistory, setFenHistory] = useState<string[]>([START_FEN])
  const [plyIndex, setPlyIndex] = useState(0)
  const [undoRemaining, setUndoRemaining] = useState(3)
  const [clockState, setClockState] = useState<{redRemaining:number;blackRemaining:number;activeSide:'red'|'black'|null}|null>(null)
  // 每次收到"服务端权威时钟"都自增,作为本地补间 effect 的唯一重captured信号:
  // 暂停后不再本地递减、悔棋(undo_result 带回权威 clockState)后以服务端值为准重置补间基准。
  const [clockEpoch, setClockEpoch] = useState(0)
  const [legalSquares, setLegalSquares] = useState<string[]>([])
  const [flipped, setFlipped] = useState(false)
  const [viewingHistory, setViewingHistory] = useState(false) // 是否正在回看历史(回看时锁盘)

  const wsRef = useRef<ReturnType<typeof connect> | null>(null)
  const gameIdRef = useRef<number | null>(null)
  gameIdRef.current = gameId
  // handleServerMsg 在 connect 时被一次性捕获;切执方/模式后即时重开局会捕获切换前的闭包。
  // side/mode 用 ref 保证 handleServerMsg 内恒读最新值(否则胜负文案/走子执方/aiReason 门控会用旧值)。
  const sideRef = useRef<HumanSide>(side)
  sideRef.current = side
  const modeRef = useRef<GameMode>(mode)
  modeRef.current = mode
  // 是否有一手"乐观 push 到 moveHistory 但服务端尚未确认"的人着。服务端 error(非法/未配置等)
  // 拒绝时据此回滚那一条,避免 ply 错位、回看整体错位(P3-26)。update 确认后清零。
  const pendingMoveRef = useRef(false)
  const isNarrow = useIsNarrow()

  // fenHistory 每个 server update 一帧(START + 每完整回合 1 帧),moveHistory 逐手。
  // 把"手号 ply"映射到最近可用的 fen 帧:人执红时人先手(floor),执黑时 AI 先手(ceil)。
  // 受限于服务端一回合只下发一帧,人类手的中间局面无独立快照,回看为回合级近似(回看时锁盘故不影响走子正确性)。
  function plyToFrame(ply: number): number {
    const f = side === 'red' ? Math.floor(ply / 2) : Math.ceil(ply / 2)
    return Math.max(0, Math.min(f, fenHistory.length - 1))
  }

  // 据 result 推导胜负文本。读 sideRef.current 而非 side 闭包:handleServerMsg 是陈旧闭包,
  // 但 sideRef 对象跨渲染稳定、.current 恒最新 → 切执方后新局胜负文案不再反转。渲染作用域调用同样正确。
  function resultText(result: GameResult): string {
    if (!result) return ''
    if (result === 'draw') return '和棋'
    return result === sideRef.current ? '你赢了！' : '你输了'
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
      // 只认本局的 update:旧局超时清扫广播的 update 帧现在也带 gameId,
      // 不属当前局则忽略,避免旧局 flag-fall 顶替正在下的新局 UI(P1-7)。
      if (msg.gameId != null && gameIdRef.current !== null && msg.gameId !== gameIdRef.current) return
      pendingMoveRef.current = false // 服务端已确认,乐观着法转正,后续 error 不再回滚它
      setFen(msg.fen)
      // 不再每手 bump fenKey:Board 由 position(fen) 受控,改 prop 即平滑动画到新局面。
      // 每手强制重挂会让棋盘整块闪烁/重刷(用户反馈问题2)。仅非法着回弹时才重挂(见 error 分支)。
      setViewingHistory(false) // 有新进展,回到最新局面
      setLastAiMove(msg.aiMove)
      setLastAiMoveZh(msg.aiMoveZh ?? null)
      setAwaitingAi(false) // AI 已回应，解锁棋盘
      setStatusError(false)
      if (msg.clockState) { setClockState(msg.clockState); setClockEpoch(e => e + 1) }
      // 中文棋谱回填:人手落地时前端只有 UCI,服务端 update 才带回 moveZh → 回填刚下的人手;
      // 再把 AI 着(含 aiMoveZh)追加。人手直接终局(无 aiMove)时也要回填,故独立于 aiMove 判断。
      setMoveHistory(prev => {
        let next = prev
        if (msg.moveZh && prev.length > 0) {
          const last = prev[prev.length - 1]
          if (last.zh === undefined && last.side === sideRef.current) {
            next = prev.slice()
            next[next.length - 1] = { ...last, zh: msg.moveZh }
          }
        }
        if (msg.aiMove) {
          const aiSide = sideRef.current === 'red' ? 'black' : 'red'
          if (next === prev) next = prev.slice()
          next.push({ ply: next.length + 1, move: msg.aiMove, side: aiSide, zh: msg.aiMoveZh })
        }
        return next
      })
      if (msg.fen) {
        setFenHistory(prev => { const next = [...prev, msg.fen]; if (next.length > 200) next.shift(); return next })
      }
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
        // 教练模式:导演给的选着解释(如"你最近连败,我这手放缓一点")随播报展示
        const reason = msg.aiReason && modeRef.current === 'coach' ? ` · ${msg.aiReason}` : ''
        const aiShown = msg.aiMoveZh ?? msg.aiMove
        setStatusMsg(aiShown ? `AI 走了 ${aiShown}${reason}，轮到您走` : '轮到您走棋')
      }
    } else if (msg.type === 'error') {
      setAwaitingAi(false)
      setStatusError(true)
      const raw = msg.message
      // 只有真的走子被拒才是"非法着法";"未配置引擎"/"AI先手失败"/"对局不存在"等直接展示服务端原文(P3-30)。
      const isIllegal = raw.startsWith('illegal move') || raw.startsWith('not your turn')
      const wasPending = pendingMoveRef.current
      if (wasPending) {
        // 乐观 push 的那一手被拒:回滚 moveHistory 那一条,避免 ply 错位/回看全错(P3-26)
        setMoveHistory(prev => prev.slice(0, -1))
        pendingMoveRef.current = false
      }
      // 走子被拒(有在途乐观着法)或明确非法时,重挂 Board 把库内乐观移动的棋子弹回真实 fen;
      // 其余纯提示类错误不动棋盘,避免无谓闪烁。
      if (wasPending || isIllegal) setFenKey(k => k + 1)
      setStatusMsg(isIllegal ? '非法着法，已回退到当前局面' : raw)
    } else if (msg.type === 'state') {
      // 断线重连后 resync 拉回的权威状态:重挂棋盘、恢复时钟、解锁棋盘(修"AI 回帧在途断线致永久锁死")。
      if (gameIdRef.current !== null && msg.gameId !== gameIdRef.current) return
      pendingMoveRef.current = false
      setAwaitingAi(false) // 无条件解锁:即便断线前在等 AI,重连后以服务端局面为准
      setViewingHistory(false)
      setFen(msg.fen)
      setFenKey(k => k + 1)
      setStatusError(false)
      if (msg.clockState) { setClockState(msg.clockState); setClockEpoch(e => e + 1) }
      if (msg.over) {
        const result = msg.result ?? null
        setGameResult(result)
        setStatus('over')
        const txt = resultText(result)
        setStatusMsg(txt ? `对局结束 — ${txt}` : '对局结束！')
      } else {
        setStatus('playing')
        setStatusMsg('已重新连接，请继续走棋')
      }
    } else if (msg.type === 'chat') {
      // 只收本局弹幕:换局瞬间旧局残留帧/多局并发时不串台
      if (gameIdRef.current !== null && msg.gameId !== gameIdRef.current) return
      setLines(prev => [...prev, {
        personaId: msg.personaId,
        text: msg.text,
        addressee: msg.addressee,
        ts: msg.ts,
      }])
    } else if (msg.type === 'draw_response') {
      if (gameIdRef.current !== null && msg.gameId !== gameIdRef.current) return
      alert(msg.accepted ? 'AI 接受和棋！' : 'AI 拒绝和棋')
    } else if (msg.type === 'undo_result') {
      if (gameIdRef.current !== null && msg.gameId !== gameIdRef.current) return
      // 悔棋余额以服务端为准(服务端有硬上限,刷新页面也不会重置)
      if (typeof msg.undoRemaining === 'number') setUndoRemaining(msg.undoRemaining)
      if (msg.success && msg.fen) {
        setFen(msg.fen)
        setFenKey(k => k + 1)
        setViewingHistory(false)
        if (typeof msg.undoRemaining !== 'number') setUndoRemaining(u => u - 1)
        setMoveHistory(prev => prev.slice(0, -2))
        // 撤回 2 手 = 回退 1 个 server 帧;保留开局帧
        setFenHistory(prev => prev.length > 1 ? prev.slice(0, -1) : prev)
        // 悔棋以服务端权威时钟为准,并 bump epoch 让本地补间重置基准(否则同侧继续走会用旧基准覆盖)
        if (msg.clockState) { setClockState(msg.clockState); setClockEpoch(e => e + 1) }
      } else {
        alert(typeof msg.undoRemaining === 'number' && msg.undoRemaining <= 0
          ? '悔棋次数已用完(每局 3 次)'
          : '无法悔棋（走法太少或非陪练模式）')
      }
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
        // 状态自愈:向服务端拉取权威 state,重挂棋盘/恢复时钟/解锁棋盘(修 update/state 在途丢失致死锁,P1-10)。
        // 仅在已有对局时发;首连(gameId 尚为 null)由 new→started 走正常流程。
        const gid = gameIdRef.current
        if (gid !== null) wsRef.current?.send({ type: 'resync', gameId: gid })
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
    ws.send({ type: 'new', mode: activeMode, humanSide: activeSide, startFen, spectators: spectatorsOn })
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
    // 与 handleRestart 对称:开新局前停掉上一局在播/排队的语音并清空旧弹幕,
    // 否则 ChatPanel remount 后会从头重扫旧 lines 重播上一局收尾语音、串台显示(P1-9)。
    stopVoice()
    cancelSpeech()
    setLines([])
    pendingMoveRef.current = false
    setMoveHistory([])
    setFenHistory([START_FEN])
    setPlyIndex(0)
    setViewingHistory(false)
    setUndoRemaining(3)
    setClockState(null)
    setLegalSquares([])
    setFlipped(false)
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
    setLegalSquares([])
    dropQueued()  // 走子:清掉没播的旧弹幕(点评的是上一步),但保留教练必答回答;语音直接接最新
    setMoveHistory(prev => [...prev, { ply: prev.length + 1, move, side }])
    pendingMoveRef.current = true // 标记这一手为"乐观未确认",若服务端拒绝则在 error 分支回滚(P3-26)
    wsRef.current?.send({ type: 'move', gameId, move })
    setAwaitingAi(true) // 等待 AI 响应，锁盘
    setStatusError(false)
    setStatusMsg(`您走了 ${move}，AI 思考中…`)
  }

  function handleRestart(activeMode?: GameMode, activeSide?: HumanSide) {
    stopVoice()   // 停掉上一局在播/排队的本地 TTS 语音,避免串台到新局
    cancelSpeech()
    pendingMoveRef.current = false
    setFen(START_FEN)
    setFenKey(k => k + 1)
    setGameId(null)
    setLastAiMove(null)
    setLastAiMoveZh(null)
    setLines([])
    setStatus('connecting')
    setStatusMsg('正在连接服务器...')
    setAwaitingAi(false)
    setGameResult(null)
    setStatusError(false)
    setIsSparring(false) // 手动重开时取消陪练提示
    setMoveHistory([])
    setFenHistory([START_FEN])
    setPlyIndex(0)
    setViewingHistory(false)
    setUndoRemaining(3)
    setClockState(null)
    setLegalSquares([])
    setFlipped(false)
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

  // 观众席开关:不重开局,即时通知服务端开/关弹幕生成;关闭时立刻停掉在播/排队的语音
  function handleSpectatorsToggle(on: boolean) {
    setSpectatorsOn(on)
    if (gameId !== null) wsRef.current?.send({ type: 'spectators', gameId, enabled: on })
    if (!on) { stopVoice(); cancelSpeech() }
  }

  // 窄屏下棋盘尺寸：视口宽度减边距，最大 460；宽屏 500
  const boardSize = isNarrow
    ? Math.min(typeof window !== 'undefined' ? window.innerWidth - 32 : 460, 460)
    : 500

  const boardOrientation = (side === 'black' && !flipped) || (side === 'red' && flipped) ? 'black' : 'red'

  function renderClock() {
    if (!clockState) return null
    const fmt = (ms: number) => {
      const s = Math.max(0, Math.floor(ms / 1000))
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
    }
    const active = clockState.activeSide
    return (
      <div style={styles.clockRow}>
        <div style={{...styles.clockBox, ...(active==='red'?styles.clockActive:{}), ...(clockState.redRemaining<30000?styles.clockLow:{})}}>
          <span style={styles.clockLabel}>红方</span>
          <span style={styles.clockTime}>{fmt(clockState.redRemaining)}</span>
        </div>
        <div style={{...styles.clockBox, ...(active==='black'?styles.clockActive:{}), ...(clockState.blackRemaining<30000?styles.clockLow:{})}}>
          <span style={styles.clockLabel}>黑方</span>
          <span style={styles.clockTime}>{fmt(clockState.blackRemaining)}</span>
        </div>
      </div>
    )
  }

  // 非回看态下,当前查看手号始终跟随最新走法(供 MoveList 高亮);回看时由 onNavigate 控制
  useEffect(() => {
    if (!viewingHistory) setPlyIndex(moveHistory.length)
  }, [moveHistory.length, viewingHistory])

  // 本地计时仅作视觉补间:每次收到服务端权威时钟(clockEpoch 自增)就重新捕获基准(剩余值+起始时刻),
  // 按真实时间差递减,避免 setInterval 间隔不精确导致的累积漂移。
  //  - 仅在 status==='playing' 时补间:暂停(paused)/结束(over)/等待时不本地递减,以服务端为准(P3 时钟补间);
  //  - 悔棋 undo_result 带回权威 clockState 时 clockEpoch 自增 → 本 effect 重跑、以服务端值重置基准。
  useEffect(() => {
    if (status !== 'playing') return
    if (!clockState || clockState.activeSide === null) return
    const active = clockState.activeSide
    const startTime = Date.now()
    const startRed = clockState.redRemaining
    const startBlack = clockState.blackRemaining
    const iv = setInterval(() => {
      const elapsed = Date.now() - startTime
      setClockState(prev => {
        if (!prev || prev.activeSide !== active) return prev
        if (active === 'red') return { ...prev, redRemaining: Math.max(0, startRed - elapsed) }
        return { ...prev, blackRemaining: Math.max(0, startBlack - elapsed) }
      })
    }, 200)
    return () => clearInterval(iv)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clockEpoch, status])

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
          {lastAiMove && !awaitingAi && <span style={styles.aiMove}>AI 上一手 {lastAiMoveZh ?? lastAiMove}</span>}
        </div>
      </div>

      {renderClock()}

      {primaryAction}

      {status === 'playing' && gameId !== null && (
        <div style={styles.actionRow}>
          <button style={styles.actionBtn} onClick={() => { if (confirm('确定认输？')) wsRef.current?.send({ type: 'resign', gameId }) }}>认输</button>
          <button style={styles.actionBtn} onClick={() => wsRef.current?.send({ type: 'draw_offer', gameId })}>提和</button>
          {mode === 'coach' && (
            <button style={{...styles.actionBtn, ...(undoRemaining<=0?{opacity:.4}:{})}} disabled={undoRemaining<=0}
              onClick={() => wsRef.current?.send({ type: 'undo', gameId })}>悔棋({undoRemaining})</button>
          )}
        </div>
      )}

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

        <div style={styles.settingRow}>
          <span style={styles.settingLabel}>观众席</span>
          <div style={styles.pillGroup}>
            <button style={pill(spectatorsOn, color.success, '#fff')} onClick={() => handleSpectatorsToggle(true)}
              aria-label="开启观众席" aria-pressed={spectatorsOn}>开</button>
            <button style={pill(!spectatorsOn, color.surfaceHover, color.text)} onClick={() => handleSpectatorsToggle(false)}
              aria-label="关闭观众席" aria-pressed={!spectatorsOn}>关</button>
          </div>
        </div>
        <p style={styles.settingHint}>{spectatorsOn ? '旁观者弹幕+语音照常' : '已静场:无弹幕、无语音,专心下棋'}</p>
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
    <div style={{ ...styles.page, ...(isNarrow ? styles.pageNarrow : styles.pageWide) }}>
      <div style={{ ...styles.studio, flexDirection: isNarrow ? 'column' : 'row', alignItems: isNarrow ? 'center' : 'flex-start', ...(isNarrow ? {} : styles.studioWide) }}>
        {sidebar}

        <div style={{ ...styles.centerCol, ...(isNarrow ? {} : styles.centerColWide) }}>
          <button style={styles.flipBtn} onClick={() => setFlipped(f => !f)} aria-label="翻转棋盘">↻ 翻转棋盘</button>
          <div style={styles.boardWrapper}>
            <Board
              key={fenKey}
              fen={fen}
              onMove={handleMove}
              size={boardSize}
              lastMove={lastAiMove}
              disabled={awaitingAi || status !== 'playing' || viewingHistory}
              orientation={boardOrientation}
              legalSquares={legalSquares}
              onSquareSelect={(sq) => {
                fetch(`${HTTP_BASE}/legal-moves?fen=${encodeURIComponent(fen)}&square=${sq}`)
                  .then(r => r.json()).then(d => setLegalSquares(d.squares)).catch(() => setLegalSquares([]))
              }}
            />
          </div>
        </div>

        <div style={{ ...styles.chatCol, display: 'flex', flexDirection: 'column', gap: space.sm, height: isNarrow ? undefined : '100%', ...(isNarrow ? { width: '100%', maxWidth: 480 } : { maxHeight: '100%' }) }}>
          {/* 语音/弹幕框:占右栏上部 */}
          <div style={{ flex: 1, minHeight: isNarrow ? 380 : 0 }}>
            <ChatPanel
              key={gameId ?? 'idle'}
              lines={lines}
              enabled={spectatorsOn}
              onSay={(t) => {
                if (status === 'playing' && gameId !== null) {
                  dropQueued()  // 让路:清掉在途旧弹幕,教练回答优先
                  wsRef.current?.send({ type: 'say', gameId, text: t })
                }
              }}
            />
          </div>
          {/* 行棋记录:填到语音框下方的空地 */}
          <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={styles.moveListTitle}>行棋记录</div>
            <MoveList moves={moveHistory} currentPly={plyIndex} onNavigate={(ply) => {
              // 点到最新手(或更后)→ 退出回看,回到最新局面
              if (ply >= moveHistory.length) {
                setViewingHistory(false)
                setPlyIndex(moveHistory.length)
                const latest = fenHistory[fenHistory.length - 1]
                if (latest) { setFen(latest); setFenKey(k => k + 1) }
                return
              }
              // 回看历史:映射到最近可用的 server 帧并锁盘
              const f = fenHistory[plyToFrame(ply)]
              if (f) {
                setFen(f)
                setFenKey(k => k + 1)
                setPlyIndex(ply)
                setViewingHistory(true)
              }
            }} />
          </div>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    boxSizing: 'border-box',
    padding: `${space.lg}px ${space.lg}px`,
    background: color.bg,
    color: color.text,
    fontFamily: font.sans,
  },
  // 宽屏:固定视口外壳——整页恰好占一屏高、不产生页面级滚动(问题2:窗口固定,非无限下拉)。
  // 溢出由各列内部滚动消化(棋盘定尺居中不动,走法记录在其下方独立滚动)。
  pageWide: {
    height: 'calc(100dvh - 52px)',
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  // 窄屏:回退为可纵向滚动的堆叠布局(移动端本就期望滚动)
  pageNarrow: {
    minHeight: 'calc(100dvh - 52px)',
    overflowY: 'auto',
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
  studioWide: { flex: 1, minHeight: 0, overflow: 'hidden' },
  // 宽屏中列填满可用高度,棋盘定尺不动并在列内垂直居中(走法记录已移到右栏,这列只剩棋盘)
  centerColWide: { height: '100%', minHeight: 0, overflow: 'hidden', gap: space.sm, justifyContent: 'center' },
  moveListTitle: { fontSize: fontSize.xs, color: color.textMuted, letterSpacing: '0.08em', paddingLeft: 2 },
  rail: {
    width: 264,
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: space.md,
    alignSelf: 'stretch',
    minHeight: 0,
    overflowY: 'auto', // 固定视口下侧栏内容超高时自身滚动,不撑破整页
  },
  centerCol: {
    flexShrink: 0,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
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
  clockRow: { display: 'flex', gap: 8, marginTop: 8 },
  clockBox: { flex: 1, padding: '6px 10px', borderRadius: 6, background: color.surface, border: `1px solid ${color.border}`, textAlign: 'center' as const },
  clockActive: { borderColor: color.gold, boxShadow: `0 0 8px ${color.gold}44` },
  clockLow: { borderColor: color.danger, color: color.danger },
  clockLabel: { display: 'block', fontSize: 11, color: color.textMuted, marginBottom: 2 },
  clockTime: { fontSize: 22, fontFamily: 'monospace', fontWeight: 700 },
  actionRow: { display: 'flex', gap: 6, marginTop: 8 },
  actionBtn: { flex: 1, padding: '6px 0', borderRadius: 6, border: `1px solid ${color.border}`, background: color.surface, color: color.text, fontSize: fontSize.sm, cursor: 'pointer', textAlign: 'center' as const },
  flipBtn: { display: 'block', margin: '0 auto 6px', padding: '2px 10px', borderRadius: 4, border: `1px solid ${color.border}`, background: color.surface, color: color.textMuted, fontSize: fontSize.xs, cursor: 'pointer' },
}
