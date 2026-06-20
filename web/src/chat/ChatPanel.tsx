import { useEffect, useRef, useState } from 'react'
import { speak, setMuted, isMuted, isTtsSupported, cancelSpeech } from '../voice/browser-tts.js'
import { useSpeechInput } from '../voice/use-speech-input.js'

export interface ChatLine {
  personaId: string
  text: string
  addressee: string
  ts: string
}

const PERSONA_NAMES: Record<string, string> = {
  player: '老黑',
  laopaoer: '炮儿爷',
  coach: '林教练',
  netizen: '吃瓜阿强',
}

const PERSONA_COLORS: Record<string, string> = {
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
}

export function ChatPanel({ lines, onSay }: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // ── 语音播报 ──────────────────────────────────────────
  const spokenCount = useRef(0)
  const [muted, setMutedState] = useState(isMuted())
  const ttsOk = isTtsSupported()

  useEffect(() => {
    for (let i = spokenCount.current; i < lines.length; i++) {
      const l = lines[i]
      speak(l.personaId, l.text)
    }
    spokenCount.current = lines.length
  }, [lines])

  // ── 麦克风听写 ────────────────────────────────────────
  const stt = useSpeechInput((text) => onSay(text))

  // ── 新消息滚到底部 ────────────────────────────────────
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [lines])

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
    setMuted(n)
    setMutedState(n)
  }

  // cancelSpeech 在 PlayPage 重开局时使用，此处只引入不调用
  void cancelSpeech

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span>观众席</span>
        <button
          style={{
            ...styles.muteBtn,
            opacity: ttsOk ? 1 : 0.4,
            cursor: ttsOk ? 'pointer' : 'not-allowed',
          }}
          onClick={ttsOk ? toggleMute : undefined}
          title={ttsOk ? (muted ? '点击开启播报' : '点击静音') : '浏览器不支持语音合成'}
          disabled={!ttsOk}
        >
          {muted ? '🔇' : '🔊'}
        </button>
      </div>

      <div style={styles.list}>
        {lines.length === 0 && (
          <div style={styles.empty}>还没有消息……等一等看</div>
        )}
        {lines.map((line, i) => {
          const color = avatarColor(line.personaId)
          const name = personaName(line.personaId)
          return (
            <div key={i} style={styles.row}>
              {/* 头像色块 */}
              <div style={{ ...styles.avatar, background: color }}>
                {name.charAt(0)}
              </div>
              <div style={styles.bubble}>
                <div style={styles.meta}>
                  <span style={{ ...styles.name, color }}>{name}</span>
                  {line.addressee && line.addressee !== 'all' && (
                    <span style={styles.addressee}>→ {line.addressee}</span>
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
              background: stt.listening ? '#e67e22' : 'rgba(255,255,255,0.1)',
              border: stt.listening ? '1px solid #e67e22' : '1px solid rgba(255,255,255,0.2)',
            }}
            onClick={stt.listening ? stt.stop : stt.start}
            title={stt.listening ? '聆听中，点击停止' : '点击语音输入'}
          >
            {stt.listening ? '🎤聆听中' : '🎤'}
          </button>
        ) : (
          <button
            style={{ ...styles.micBtn, opacity: 0.3, cursor: 'not-allowed' }}
            disabled
            title="浏览器不支持语音识别"
          >
            🎤
          </button>
        )}
        <input
          style={styles.input}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="说点什么…"
          maxLength={200}
        />
        <button style={styles.sayBtn} onClick={submit}>
          说
        </button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    display: 'flex',
    flexDirection: 'column',
    width: '260px',
    minWidth: '220px',
    maxWidth: '300px',
    height: '540px',
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '10px',
    border: '1px solid rgba(255,255,255,0.1)',
    overflow: 'hidden',
    fontFamily: '"Noto Serif SC", "Source Han Serif", serif',
    color: '#eee',
  },
  header: {
    padding: '10px 14px',
    fontSize: '0.9rem',
    fontWeight: 700,
    color: '#f5c518',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
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
    color: '#f5c518',
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
    color: '#666',
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
    background: 'rgba(255,255,255,0.07)',
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
    color: '#aaa',
  },
  ts: {
    fontSize: '0.68rem',
    color: '#666',
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
    borderTop: '1px solid rgba(255,255,255,0.1)',
    flexShrink: 0,
    alignItems: 'center',
  },
  micBtn: {
    flexShrink: 0,
    padding: '6px 8px',
    borderRadius: '6px',
    cursor: 'pointer',
    fontSize: '0.85rem',
    color: '#eee',
    transition: 'background 0.2s',
  },
  input: {
    flex: 1,
    padding: '6px 10px',
    background: 'rgba(255,255,255,0.08)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: '6px',
    color: '#eee',
    fontSize: '0.85rem',
    outline: 'none',
    fontFamily: 'inherit',
  },
  sayBtn: {
    padding: '6px 14px',
    background: '#c0392b',
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    cursor: 'pointer',
    fontWeight: 700,
    fontSize: '0.85rem',
  },
}
