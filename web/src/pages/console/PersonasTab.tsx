import { useState } from 'react'
import { cardStyle } from '../../ui/PageShell.js'
import { color, space, radius, fontSize, btn } from '../../ui/theme.js'
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
    <div style={{ ...cardStyle, marginBottom: space.lg }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: space.md }}>
        <h3 style={{ color: color.gold, margin: 0, fontSize: fontSize.md }}>{p.id}{p.isPlayer ? '(棋手)' : '(观棋)'}</h3>
        <label style={{ color: color.textMuted, fontSize: fontSize.sm }}>
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
      <div style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
        <button style={btn('primary')} onClick={save}>保存</button>
        <button style={btn('secondary')} onClick={reset}>恢复默认</button>
        {msg && <span style={{ color: msg.includes('失败') ? color.danger : color.success, fontSize: fontSize.sm }}>{msg}</span>}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', color: color.textMuted, fontSize: fontSize.sm, marginBottom: space.md }
const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: space.xs, padding: '6px 8px', background: color.surfaceAlt, color: color.text, border: `1px solid ${color.border}`, borderRadius: radius.md, fontFamily: 'inherit', boxSizing: 'border-box' }
