import { useEffect, useRef, useState } from 'react'
import { setMuted, isMuted, isTtsSupported, hasZhVoice, cancelSpeech } from '../voice/browser-tts.js'
import { speakServer } from '../voice/server-tts.js'
import { useSpeechInput } from '../voice/use-speech-input.js'

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
}

export function ChatPanel({ lines, onSay }: Props) {
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)

  // ── 语音播报 ──────────────────────────────────────────
  const spokenCount = useRef(0)
  const [muted, setMutedState] = useState(isMuted())
  const ttsOk = isTtsSupported()
  const zhVoiceOk = hasZhVoice()

  useEffect(() => {
    for (let i = spokenCount.current; i < lines.length; i++) {
      const l = lines[i]
      // 用户自己的发言(human)只显示不朗读;观棋者照常有声
      if (l.personaId === 'human') continue
      speakServer(l.personaId, l.text)
    }
    spokenCount.current = lines.length
  }, [lines])

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
    setMuted(n)       // browser-tts 内部已持久化 localStorage
    setMutedState(n)
  }

  // cancelSpeech 在 PlayPage 重开局时使用，此处只引入不调用
  void cancelSpeech

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
        {lines.length === 0 && (
          <div style={styles.empty}>还没有消息……等一等看</div>
        )}
        {lines.map((line, i) => {
          const color = avatarColor(line.personaId)
          const name = personaName(line.personaId)
          const addrDisplay = addresseeName(line.addressee)
          return (
            <div key={i} style={styles.row}>
              {/* 头像色块 */}
              <div style={{ ...styles.avatar, background: color }} aria-hidden="true">
                {name.charAt(0)}
              </div>
              <div style={styles.bubble}>
                <div style={styles.meta}>
                  <span style={{ ...styles.name, color }}>{name}</span>
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
              background: stt.listening ? '#e67e22' : 'rgba(255,255,255,0.1)',
              border: stt.listening ? '1px solid #e67e22' : '1px solid rgba(255,255,255,0.2)',
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
          placeholder="说点什么…"
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
    background: 'rgba(255,255,255,0.05)',
    borderRadius: '14px',
    border: '1px solid rgba(255,255,255,0.1)',
    overflow: 'hidden',
    fontFamily: '"Noto Sans SC", system-ui, sans-serif',
    color: '#ececf2',
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
  noVoiceHint: {
    fontSize: '0.7rem',
    color: '#aaa',
    whiteSpace: 'nowrap' as const,
  },
  sttError: {
    padding: '4px 10px',
    fontSize: '0.75rem',
    color: '#ff6b6b',
    background: 'rgba(255,107,107,0.1)',
    borderTop: '1px solid rgba(255,107,107,0.2)',
    textAlign: 'center' as const,
  },
}
