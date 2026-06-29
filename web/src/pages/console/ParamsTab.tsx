import { useState } from 'react'
import { cardStyle } from '../../ui/PageShell.js'
import { color, space, radius, fontSize, btn as btnStyle } from '../../ui/theme.js'
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
  // 编辑态允许空串(用户清空再输入的临时态);保存时再校验/回填。
  const [vals, setVals] = useState<Record<string, number | ''>>(() => Object.fromEntries(fields.map(f => [f.key, initial[f.key]])))
  const [msg, setMsg] = useState<string | null>(null)
  const save = async () => {
    setMsg(null)
    // 保存前剔除空串/非有限数,避免 JSON 序列化成 null 提交给后端。
    const payload: NumMap = {}
    for (const f of fields) {
      const raw = vals[f.key]
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (raw === '' || !Number.isFinite(n)) { setMsg(`保存失败:${f.label} 不是有效数字`); return }
      payload[f.key] = n
    }
    try { await putSection(section, payload); setMsg('已保存'); onChanged() } catch (e) { setMsg('保存失败:' + (e as Error).message) }
  }
  return (
    <div style={{ ...cardStyle, marginBottom: space.lg }}>
      <h3 style={{ color: color.gold, margin: `0 0 ${space.md}px`, fontSize: fontSize.md }}>{title}</h3>
      {fields.map(f => (
        <label key={f.key} style={lbl}>
          <span>{f.label}{f.help ? <span style={{ color: color.textFaint }}>（{f.help}）</span> : null}</span>
          <input style={inp} type="number" min={f.min} max={f.max} step={f.step}
            value={vals[f.key]} onChange={e => {
              const raw = e.target.value
              const n = Number(raw)
              // 仅在空串(临时态)或有限数时更新,过滤 '-'/'1e'/'.' 等中间态产生的 NaN。
              if (raw === '' || Number.isFinite(n)) setVals(v => ({ ...v, [f.key]: raw === '' ? '' : n }))
            }} />
        </label>
      ))}
      {note && <p style={{ color: color.textFaint, fontSize: fontSize.xs }}>{note}</p>}
      <button style={btnStyle('primary')} onClick={save}>保存{title}</button>
      {msg && <span style={{ marginLeft: space.sm, color: msg.includes('失败') ? color.danger : color.success, fontSize: fontSize.sm }}>{msg}</span>}
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
    <div style={{ ...cardStyle, marginBottom: space.lg }}>
      <h3 style={{ color: color.gold, margin: `0 0 ${space.md}px`, fontSize: fontSize.md }}>导演(按模式)</h3>
      {(['coach', 'humanlike'] as const).map(mode => (
        <div key={mode} style={{ marginBottom: space.md }}>
          <div style={{ color: color.textMuted, fontWeight: 700, marginBottom: space.xs + 2 }}>{mode === 'coach' ? '陪练模式' : '拟人模式'}</div>
          <label style={lbl}>最大让分(maxDropCp)<input style={inp} type="number" min={0} max={2000} step={10} value={d[mode].maxDropCp} onChange={e => upd(mode, { maxDropCp: Number(e.target.value) })} /></label>
          <label style={lbl}>目标区间下界<input style={inp} type="number" min={-2000} max={2000} step={10} value={d[mode].targetBand.low} onChange={e => upd(mode, { targetBand: { ...d[mode].targetBand, low: Number(e.target.value) } })} /></label>
          <label style={lbl}>目标区间上界<input style={inp} type="number" min={-2000} max={2000} step={10} value={d[mode].targetBand.high} onChange={e => upd(mode, { targetBand: { ...d[mode].targetBand, high: Number(e.target.value) } })} /></label>
          <label style={lbl}>拟人强度<input style={inp} type="number" min={0} max={1} step={0.05} value={d[mode].strength} onChange={e => upd(mode, { strength: Number(e.target.value) })} /></label>
        </div>
      ))}
      <button style={btnStyle('primary')} onClick={save}>保存导演</button>
      {msg && <span style={{ marginLeft: space.sm, color: msg.includes('失败') ? color.danger : color.success, fontSize: fontSize.sm }}>{msg}</span>}
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: space.md, color: color.textMuted, fontSize: fontSize.sm, marginBottom: space.sm }
const inp: React.CSSProperties = { width: 140, padding: '5px 8px', background: color.surfaceAlt, color: color.text, border: `1px solid ${color.border}`, borderRadius: radius.md, fontFamily: 'inherit' }
