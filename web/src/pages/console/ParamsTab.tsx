import { useState } from 'react'
import { cardStyle } from '../../ui/PageShell.js'
import { putSection, type ChatCfg, type DirectorCfg, type EngineCfg, type DiagnoseCfg, type ConfigSection } from '../../api/admin.js'
import { PARAM_FIELDS } from './console-data.js'

type NumMap = Record<string, number>

export function ParamsTab({ chat, director, engine, diagnose, onChanged }:
  { chat: ChatCfg; director: DirectorCfg; engine: EngineCfg; diagnose: DiagnoseCfg; onChanged: () => void }) {
  return (
    <div>
      <NumSection title="聊天节奏" section="chat" fields={PARAM_FIELDS.chat} initial={chat as unknown as NumMap} onChanged={onChanged} />
      <NumSection title="引擎" section="engine" fields={PARAM_FIELDS.engine} initial={{ multipv: engine.multipv, movetime: engine.movetime }} onChanged={onChanged} note={`引擎路径(需重启):${engine.pikafishPath ?? '(未设置,用 PIKAFISH_PATH)'}`} />
      <NumSection title="诊断" section="diagnose" fields={PARAM_FIELDS.diagnose} initial={diagnose as unknown as NumMap} onChanged={onChanged} />
      <DirectorSection director={director} onChanged={onChanged} />
    </div>
  )
}

function NumSection({ title, section, fields, initial, onChanged, note }:
  { title: string; section: ConfigSection; fields: typeof PARAM_FIELDS.chat; initial: NumMap; onChanged: () => void; note?: string }) {
  const [vals, setVals] = useState<NumMap>(() => Object.fromEntries(fields.map(f => [f.key, initial[f.key]])))
  const [msg, setMsg] = useState<string | null>(null)
  const save = async () => {
    setMsg(null)
    try { await putSection(section, vals); setMsg('已保存'); onChanged() } catch (e) { setMsg('保存失败:' + (e as Error).message) }
  }
  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <h3 style={{ color: '#f5c518', margin: '0 0 12px', fontSize: '1rem' }}>{title}</h3>
      {fields.map(f => (
        <label key={f.key} style={lbl}>
          <span>{f.label}{f.help ? <span style={{ color: '#888' }}>（{f.help}）</span> : null}</span>
          <input style={inp} type="number" min={f.min} max={f.max} step={f.step}
            value={vals[f.key]} onChange={e => setVals(v => ({ ...v, [f.key]: Number(e.target.value) }))} />
        </label>
      ))}
      {note && <p style={{ color: '#888', fontSize: '0.78rem' }}>{note}</p>}
      <button style={btn} onClick={save}>保存{title}</button>
      {msg && <span style={{ marginLeft: 10, color: msg.includes('失败') ? '#ff6b6b' : '#8bc34a', fontSize: '0.82rem' }}>{msg}</span>}
    </div>
  )
}

function DirectorSection({ director, onChanged }: { director: DirectorCfg; onChanged: () => void }) {
  const [d, setD] = useState<DirectorCfg>(director)
  const [msg, setMsg] = useState<string | null>(null)
  const upd = (mode: 'coach' | 'humanlike', patch: Partial<DirectorCfg['coach']>) =>
    setD(prev => ({ ...prev, [mode]: { ...prev[mode], ...patch } }))
  const save = async () => {
    setMsg(null)
    try { await putSection('director', d as unknown as Record<string, unknown>); setMsg('已保存'); onChanged() } catch (e) { setMsg('保存失败:' + (e as Error).message) }
  }
  return (
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <h3 style={{ color: '#f5c518', margin: '0 0 12px', fontSize: '1rem' }}>导演(按模式)</h3>
      {(['coach', 'humanlike'] as const).map(mode => (
        <div key={mode} style={{ marginBottom: 12 }}>
          <div style={{ color: '#ccc', fontWeight: 700, marginBottom: 6 }}>{mode === 'coach' ? '陪练模式' : '拟人模式'}</div>
          <label style={lbl}>最大让分(maxDropCp)<input style={inp} type="number" min={0} max={2000} step={10} value={d[mode].maxDropCp} onChange={e => upd(mode, { maxDropCp: Number(e.target.value) })} /></label>
          <label style={lbl}>目标区间下界<input style={inp} type="number" min={-2000} max={2000} step={10} value={d[mode].targetBand.low} onChange={e => upd(mode, { targetBand: { ...d[mode].targetBand, low: Number(e.target.value) } })} /></label>
          <label style={lbl}>目标区间上界<input style={inp} type="number" min={-2000} max={2000} step={10} value={d[mode].targetBand.high} onChange={e => upd(mode, { targetBand: { ...d[mode].targetBand, high: Number(e.target.value) } })} /></label>
          <label style={lbl}>拟人强度<input style={inp} type="number" min={0} max={1} step={0.05} value={d[mode].strength} onChange={e => upd(mode, { strength: Number(e.target.value) })} /></label>
        </div>
      ))}
      <button style={btn} onClick={save}>保存导演</button>
      {msg && <span style={{ marginLeft: 10, color: msg.includes('失败') ? '#ff6b6b' : '#8bc34a', fontSize: '0.82rem' }}>{msg}</span>}
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, color: '#ccc', fontSize: '0.85rem', marginBottom: 8 }
const inp: React.CSSProperties = { width: 140, padding: '5px 8px', background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 4, fontFamily: 'inherit' }
const btn: React.CSSProperties = { background: '#f5c518', color: '#1a1a2e', border: 'none', borderRadius: 6, padding: '7px 18px', cursor: 'pointer', fontWeight: 700 }
