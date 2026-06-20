import { useState } from 'react'
import { cardStyle } from '../../ui/PageShell.js'
import { putPersona, resetPersona, type PersonaConfig } from '../../api/admin.js'
import { VOICES } from './console-data.js'

export function PersonasTab({ personas, onChanged }: { personas: PersonaConfig[]; onChanged: () => void }) {
  return (
    <div>
      {personas.map(p => <PersonaCard key={p.id} p={p} onChanged={onChanged} />)}
    </div>
  )
}

function PersonaCard({ p, onChanged }: { p: PersonaConfig; onChanged: () => void }) {
  const [name, setName] = useState(p.name)
  const [background, setBackground] = useState(p.background)
  const [voiceStyle, setVoiceStyle] = useState(p.voiceStyle)
  const [leaning, setLeaning] = useState(p.leaning)
  const [ttsVoice, setTtsVoice] = useState(p.ttsVoice)
  const [enabled, setEnabled] = useState(p.enabled)
  const [msg, setMsg] = useState<string | null>(null)

  const save = async () => {
    setMsg(null)
    try { await putPersona(p.id, { name, background, voiceStyle, leaning, ttsVoice, enabled }); setMsg('已保存'); onChanged() }
    catch (e) { setMsg('保存失败:' + (e as Error).message) }
  }
  const reset = async () => {
    setMsg(null)
    try { await resetPersona(p.id); setMsg('已恢复默认'); onChanged() }
    catch (e) { setMsg('恢复失败:' + (e as Error).message) }
  }

  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ color: '#f5c518', margin: 0, fontSize: '1rem' }}>{p.id}{p.isPlayer ? '(棋手)' : '(观棋)'}</h3>
        <label style={{ color: '#ccc', fontSize: '0.82rem' }}>
          <input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> 启用
        </label>
      </div>
      <label style={lbl}>名字<input style={inp} value={name} onChange={e => setName(e.target.value)} /></label>
      <label style={lbl}>背景<textarea style={{ ...inp, minHeight: 56, resize: 'vertical' }} value={background} onChange={e => setBackground(e.target.value)} /></label>
      <label style={lbl}>口吻脾气<input style={inp} value={voiceStyle} onChange={e => setVoiceStyle(e.target.value)} /></label>
      <label style={lbl}>帮踩倾向<input style={inp} value={leaning} onChange={e => setLeaning(e.target.value)} /></label>
      <label style={lbl}>音色
        <select style={inp} value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}>
          {VOICES.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </label>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={btn} onClick={save}>保存</button>
        <button style={btnGhost} onClick={reset}>恢复默认</button>
        {msg && <span style={{ color: msg.includes('失败') ? '#ff6b6b' : '#8bc34a', fontSize: '0.82rem' }}>{msg}</span>}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', color: '#ccc', fontSize: '0.85rem', marginBottom: 10 }
const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }
const btn: React.CSSProperties = { background: '#f5c518', color: '#1a1a2e', border: 'none', borderRadius: 6, padding: '7px 18px', cursor: 'pointer', fontWeight: 700 }
const btnGhost: React.CSSProperties = { background: 'transparent', color: '#bbb', border: '1px solid #333', borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }
