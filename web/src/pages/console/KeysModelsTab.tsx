import { useEffect, useState } from 'react'
import { cardStyle } from '../../ui/PageShell.js'
import { color, space, radius, fontSize, btn as btnStyle } from '../../ui/theme.js'
import { putSection, revealLlmKey, type LlmCfg } from '../../api/admin.js'
import { displayMaskedKey } from './console-data.js'

export function KeysModelsTab({ llm, onChanged }: { llm: LlmCfg; onChanged: () => void }) {
  const [apiKey, setApiKey] = useState('')          // 留空=不改 key
  const [revealed, setRevealed] = useState<string | null>(null)
  const [model, setModel] = useState(llm.model)
  const [baseURL, setBaseURL] = useState(llm.baseURL ?? '')
  const [msg, setMsg] = useState<string | null>(null)

  // 明文 key 揭示后 20s 自动清除,组件卸载也清,避免长期留屏被旁观或截图泄露。
  useEffect(() => {
    if (revealed == null) return
    const t = setTimeout(() => setRevealed(null), 20000)
    return () => clearTimeout(t)
  }, [revealed])

  const saveLlm = async () => {
    setMsg(null)
    const patch: Record<string, unknown> = { model, baseURL }
    if (apiKey.trim() !== '') patch.apiKey = apiKey.trim()
    try { await putSection('llm', patch); setMsg('已保存 LLM 配置'); setApiKey(''); setRevealed(null); onChanged() }
    catch (e) { setMsg('保存失败:' + (e as Error).message) }
  }
  const doReveal = async () => {
    try { setRevealed((await revealLlmKey()).apiKey) } catch (e) { setMsg('读取失败:' + (e as Error).message) }
  }

  return (
    <div>
      <div style={cardStyle}>
        <h3 style={h3}>LLM(百炼)</h3>
        <label style={lbl}>API Key
          <div style={{ display: 'flex', gap: space.sm, alignItems: 'center' }}>
            <input style={inp} type="text" placeholder={`当前 ${displayMaskedKey(llm.apiKey)},留空则不改`} value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <button style={btnStyle('secondary', { size: 'sm' })} onClick={doReveal}>显示当前</button>
          </div>
        </label>
        {revealed != null && <p style={{ color: color.success, fontSize: fontSize.sm, wordBreak: 'break-all' }}>{revealed}</p>}
        <label style={lbl}>模型<input style={inp} value={model} onChange={e => setModel(e.target.value)} /></label>
        <label style={lbl}>Base URL<input style={inp} value={baseURL} onChange={e => setBaseURL(e.target.value)} /></label>
        <button style={btnStyle('primary')} onClick={saveLlm}>保存 LLM</button>
      </div>

      {msg && <p style={{ color: msg.includes('失败') ? color.danger : color.success, marginTop: space.md }}>{msg}</p>}
      <p style={{ color: color.textFaint, fontSize: fontSize.xs, marginTop: space.sm }}>改 LLM key/模型/Base URL 即时热重载,无需重启。</p>
    </div>
  )
}

const h3: React.CSSProperties = { color: color.gold, margin: `0 0 ${space.md}px`, fontSize: fontSize.md }
const lbl: React.CSSProperties = { display: 'block', color: color.textMuted, fontSize: fontSize.sm, marginBottom: space.md }
const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: space.xs, padding: '6px 8px', background: color.surfaceAlt, color: color.text, border: `1px solid ${color.border}`, borderRadius: radius.md, fontFamily: 'inherit', boxSizing: 'border-box' }
