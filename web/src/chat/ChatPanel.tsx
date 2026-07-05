import { useCallback, useEffect, useRef, useState } from 'react'
import { setMuted, isMuted, isTtsSupported, hasZhVoice, cancelSpeech } from '../voice/browser-tts.js'
import { speakServer, stopVoice } from '../voice/server-tts.js'
import { useSpeechInput } from '../voice/use-speech-input.js'
import { color, font } from '../ui/theme.js'

export interface ChatLine {
  personaId: string
  text: string
  addressee: string
  ts: string
}

export const PERSONA_NAMES: Record<string, string> = {
  player: '老黑',
  laopaoer: '炮儿爷',
  coach: '林教练',
  netizen: '吃瓜阿强',
  human: '你',
}

/** addressee 字段转可读中文名：'human'→'你'，'all'/空→不显示，其余查映射表 */
function addresseeName(addressee: string): string | null {
  if (!addressee || addressee === 'all') return null
  if (addressee === 'human') return '你'
  return PERSONA_NAMES[addressee] ?? addressee
}

export const PERSONA_COLORS: Record<string, string> = {
  player: '#e74c3c',
  laopaoer: '#e67e22',
  coach: '#27ae60',
  netizen: '#2980b9',
}

function avatarColor(personaId: string): string {
  return PERSONA_COLORS[personaId] ?? '#8e44ad'
}

function personaName(personaId: string): string {
  return PERSONA_NAMES[personaId] ?? personaId
}

interface Props {
  lines: ChatLine[]
  onSay: (text: string) => void
  /** 观众席是否开启;关闭时只显示静场占位,不渲染弹幕/输入(服务端已同时停生成) */
  enabled?: boolean
}

export function ChatPanel({ lines, onSay, enabled = true }: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // ── 语音播报 + 文字-语音同步 ──────────────────────────────
  // 同步策略:每条弹幕的气泡"等到它那句语音开始播放的瞬间"才揭示,文字随声音一起出现。
  // - processed:已发起朗读/排程揭示的行数(避免重复处理)
  // - revealedCount(ref):已显示的行数,只渲染 lines[0..revealedCount)
  // - readySet:已就绪(语音起播/无声立即就绪)的行号;按序连续推进 revealedCount,保证显示顺序
  const processed = useRef(0)
  const revealedCount = useRef(0)
  const readySet = useRef<Set<number>>(new Set())
  const [, bumpReveal] = useState(0)
  const [muted, setMutedState] = useState(isMuted())
  const ttsOk = isTtsSupported()
  const zhVoiceOk = hasZhVoice()

  const markReady = useCallback((i: number) => {
    readySet.current.add(i)
    let adv = revealedCount.current
    while (readySet.current.has(adv)) adv++
    if (adv !== revealedCount.current) {
      revealedCount.current = adv
      bumpReveal(t => t + 1) // 触发重渲染,显示新揭示的气泡
    }
  }, [])

  useEffect(() => {
    for (let i = processed.current; i < lines.length; i++) {
      const idx = i
      const l = lines[idx]
      if (l.personaId === 'human' || isMuted()) {
        // 自己的话不朗读 / 静音无声 → 立即就绪(仍按序连续揭示,保持顺序)
        markReady(idx)
        continue
      }
      let fired = false
      const reveal = () => { if (!fired) { fired = true; markReady(idx) } }
      speakServer(l.personaId, l.text, reveal) // 语音起播瞬间 reveal → 同步揭示气泡
      // 兜底:6s 内语音仍未起播(未解锁/积压/合成失败漏网)也揭示,绝不卡死后续气泡
      window.setTimeout(reveal, 6000)
    }
    processed.current = lines.length
  }, [lines, markReady])

  const shownLines = lines.slice(0, revealedCount.current)

  // ── 麦克风听写 ────────────────────────────────────────
  const stt = useSpeechInput((text) => onSay(text))
  // STT 错误提示（not-allowed / no-speech / network 等）
  const sttErrorMsg: string | null = stt.error === 'not-allowed'
    ? '麦克风权限被拒，请在浏览器设置中允许麦克风'
    : stt.error === 'no-speech'
    ? '没听清，请再说一次'
    : stt.error === 'asr-unconfigured'
    ? '未配置语音识别（DASHSCOPE_API_KEY）'
    : stt.error === 'unsupported'
    ? '浏览器不支持录音'
    : stt.error
    ? '语音识别失败，请重试'
    : null

  // ── 气泡揭示后滚到底部(随揭示节奏,而非弹幕到达) ──────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [shownLines.length])

  function submit() {
    const t = input.trim()
    if (!t) return
    onSay(t)
    setInput('')
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') submit()
  }

  function toggleMute() {
    const n = !muted
    setMuted(n)       // browser-tts 内部已持久化 localStorage
    setMutedState(n)
    // 静音硬停:清掉服务端 TTS 的当前播放与预合成队列(原来只停浏览器兜底,已入队的 wav 会继续播完)
    if (n) stopVoice()
  }

  // cancelSpeech 在 PlayPage 重开局时使用，此处只引入不调用
  void cancelSpeech

  // 观众席关闭:只显示静场占位(服务端已停生成弹幕/语音)
  if (!enabled) {
    return (
      <div style={styles.panel}>
        <div style={styles.header}><span>观众席</span></div>
        <div style={{ ...styles.list, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={styles.empty}>观众席已关闭<br />在左侧「对局设置」可重新开启</div>
        </div>
      </div>
    )
  }

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span>观众席</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 无中文嗓子提示 */}
          {ttsOk && !zhVoiceOk && (
            <span style={styles.noVoiceHint} title="系统未安装中文 TTS 语音包">
              无中文语音，弹幕仅文字
            </span>
          )}
          <button
            style={{
              ...styles.muteBtn,
              opacity: ttsOk ? 1 : 0.4,
              cursor: ttsOk ? 'pointer' : 'not-allowed',
            }}
            onClick={ttsOk ? toggleMute : undefined}
            title={ttsOk ? (muted ? '点击开启播报' : '点击静音') : '浏览器不支持语音合成'}
            aria-label={ttsOk ? (muted ? '开启语音播报' : '关闭语音播报') : '浏览器不支持语音合成'}
            disabled={!ttsOk}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>
      </div>

      {/* 消息列表：aria-live 让读屏器播报新弹幕 */}
      <div style={styles.list} aria-live="polite" aria-label="观众弹幕列表">
        {shownLines.length === 0 && (
          <div style={styles.empty}>还没有消息……等一等看</div>
        )}
        {shownLines.map((line, i) => {
          const avatarBg = avatarColor(line.personaId)
          const name = personaName(line.personaId)
          const addrDisplay = addresseeName(line.addressee)
          return (
            <div key={i} style={styles.row}>
              {/* 头像色块 */}
              <div style={{ ...styles.avatar, background: avatarBg }} aria-hidden="true">
                {name.charAt(0)}
              </div>
              <div style={styles.bubble}>
                <div style={styles.meta}>
                  <span style={{ ...styles.name, color: avatarBg }}>{name}</span>
                  {addrDisplay && (
                    <span style={styles.addressee}>→ {addrDisplay}</span>
                  )}
                  <span style={styles.ts}>
                    {line.ts ? new Date(line.ts).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : ''}
                  </span>
                </div>
                <div style={styles.text}>{line.text}</div>
              </div>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div style={styles.inputRow}>
        {/* 麦克风按钮 */}
        {stt.supported ? (
          <button
            style={{
              ...styles.micBtn,
              background: stt.listening ? color.warning : color.gold,
              border: stt.listening ? `1px solid ${color.warning}` : `1px solid ${color.gold}`,
            }}
            onClick={stt.listening ? stt.stop : stt.start}
            title={stt.listening ? '聆听中，点击停止' : '点击语音输入'}
            aria-label={stt.listening ? '停止语音输入' : '开始语音输入'}
            aria-pressed={stt.listening}
          >
            {stt.listening ? '🎤聆听中' : '🎤'}
          </button>
        ) : (
          <button
            style={{ ...styles.micBtn, opacity: 0.3, cursor: 'not-allowed' }}
            disabled
            title="浏览器不支持语音识别"
            aria-label="浏览器不支持语音识别"
          >
            🎤
          </button>
        )}
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="点麦克风说话,或打字提问…"
          maxLength={200}
          aria-label="弹幕输入框"
        />
        <button style={styles.sayBtn} onClick={submit} aria-label="发送弹幕">
          说
        </button>
      </div>
      {/* STT 错误提示 */}
      {sttErrorMsg && (
        <div style={styles.sttError} role="alert">{sttErrorMsg}</div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: '100%',
    height: '100%',
    minHeight: 0,
    background: color.surfaceAlt,
    borderRadius: '14px',
    border: `1px solid ${color.border}`,
    overflow: 'hidden',
    fontFamily: font.sans,
    color: color.text,
  },
  header: {
    padding: '10px 14px',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: color.gold,
    borderBottom: `1px solid ${color.border}`,
    letterSpacing: '0.1em',
    flexShrink: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  muteBtn: {
    background: 'none',
    border: 'none',
    fontSize: '1.1rem',
    lineHeight: 1,
    padding: '2px 4px',
    borderRadius: '4px',
    color: color.gold,
  },
  list: {
    flex: 1,
    overflowY: 'auto',
    padding: '10px 10px 4px',
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  empty: {
    fontSize: '0.8rem',
    color: color.textFaint,
    textAlign: 'center',
    marginTop: '20px',
  },
  row: {
    display: 'flex',
    gap: '8px',
    alignItems: 'flex-start',
  },
  avatar: {
    flexShrink: 0,
    width: '30px',
    height: '30px',
    borderRadius: '50%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '0.8rem',
    fontWeight: 700,
    color: '#fff',
  },
  bubble: {
    flex: 1,
    background: color.surfaceHover,
    borderRadius: '8px',
    padding: '6px 8px',
  },
  meta: {
    display: 'flex',
    gap: '6px',
    alignItems: 'baseline',
    marginBottom: '3px',
    flexWrap: 'wrap',
  },
  name: {
    fontSize: '0.78rem',
    fontWeight: 700,
  },
  addressee: {
    fontSize: '0.72rem',
    color: color.textMuted,
  },
  ts: {
    fontSize: '0.68rem',
    color: color.textFaint,
    marginLeft: 'auto',
  },
  text: {
    fontSize: '0.85rem',
    lineHeight: 1.5,
    wordBreak: 'break-all',
  },
  inputRow: {
    display: 'flex',
    gap: '6px',
    padding: '8px 10px',
    borderTop: `1px solid ${color.border}`,
    flexShrink: 0,
    alignItems: 'center',
  },
  micBtn: {
    flexShrink: 0,
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: color.text,
    transition: 'background 0.2s',
  },
  input: {
    flex: 1,
    padding: '6px 10px',
    background: color.surfaceHover,
    border: `1px solid ${color.borderStrong}`,
    borderRadius: '6px',
    color: color.text,
    fontSize: '0.85rem',
    outline: 'none',
    fontFamily: 'inherit',
  },
  sayBtn: {
    padding: '6px 14px',
    background: color.red,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '0.85rem',
  },
  noVoiceHint: {
    fontSize: '0.7rem',
    color: color.textMuted,
    whiteSpace: 'nowrap' as const,
  },
  sttError: {
    padding: '4px 10px',
    fontSize: '0.75rem',
    color: color.danger,
    background: color.dangerSoft,
    borderTop: `1px solid ${color.dangerSoft}`,
    textAlign: 'center' as const,
  },
}
