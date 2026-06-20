import { useState } from 'react'
import { cardStyle } from '../../ui/PageShell.js'
import { putSection, revealLlmKey, type LlmCfg, type TtsCfg } from '../../api/admin.js'
import { displayMaskedKey } from './console-data.js'

export function KeysModelsTab({ llm, tts, onChanged }: { llm: LlmCfg; tts: TtsCfg; onChanged: () => void }) {
  const [apiKey, setApiKey] = useState('')          // 留空=不改 key
  const [revealed, setRevealed] = useState<string | null>(null)
  const [model, setModel] = useState(llm.model)
  const [baseURL, setBaseURL] = useState(llm.baseURL ?? '')
  const [ttsEndpoint, setTtsEndpoint] = useState(tts.endpoint)
  const [ttsModel, setTtsModel] = useState(tts.model)
  const [msg, setMsg] = useState<string | null>(null)

  const saveLlm = async () => {
    setMsg(null)
    const patch: Record<string, unknown> = { model, baseURL }
    if (apiKey.trim() !== '') patch.apiKey = apiKey.trim()
    try { await putSection('llm', patch); setMsg('已保存 LLM 配置'); setApiKey(''); setRevealed(null); onChanged() }
    catch (e) { setMsg('保存失败:' + (e as Error).message) }
  }
  const saveTts = async () => {
    setMsg(null)
    try { await putSection('tts', { endpoint: ttsEndpoint, model: ttsModel }); setMsg('已保存 TTS 配置'); onChanged() }
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
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input style={inp} type="text" placeholder={`当前 ${displayMaskedKey(llm.apiKey)},留空则不改`} value={apiKey} onChange={e => setApiKey(e.target.value)} />
            <button style={btnGhost} onClick={doReveal}>显示当前</button>
          </div>
        </label>
        {revealed != null && <p style={{ color: '#8bc34a', fontSize: '0.8rem', wordBreak: 'break-all' }}>{revealed}</p>}
        <label style={lbl}>模型<input style={inp} value={model} onChange={e => setModel(e.target.value)} /></label>
        <label style={lbl}>Base URL<input style={inp} value={baseURL} onChange={e => setBaseURL(e.target.value)} /></label>
        <button style={btn} onClick={saveLlm}>保存 LLM</button>
      </div>

      <div style={{ ...cardStyle, marginTop: 16 }}>
        <h3 style={h3}>TTS(qwen3-tts-flash)</h3>
        <label style={lbl}>端点<input style={inp} value={ttsEndpoint} onChange={e => setTtsEndpoint(e.target.value)} /></label>
        <label style={lbl}>模型<input style={inp} value={ttsModel} onChange={e => setTtsModel(e.target.value)} /></label>
        <button style={btn} onClick={saveTts}>保存 TTS</button>
      </div>

      {msg && <p style={{ color: msg.includes('失败') ? '#ff6b6b' : '#8bc34a', marginTop: 12 }}>{msg}</p>}
      <p style={{ color: '#888', fontSize: '0.78rem', marginTop: 8 }}>改 LLM key/模型/Base URL 即时热重载,无需重启。</p>
    </div>
  )
}

const h3: React.CSSProperties = { color: '#f5c518', margin: '0 0 12px', fontSize: '1rem' }
const lbl: React.CSSProperties = { display: 'block', color: '#ccc', fontSize: '0.85rem', marginBottom: 12 }
const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }
const btn: React.CSSProperties = { background: '#f5c518', color: '#1a1a2e', border: 'none', borderRadius: 6, padding: '7px 18px', cursor: 'pointer', fontWeight: 700 }
const btnGhost: React.CSSProperties = { background: 'transparent', color: '#bbb', border: '1px solid #333', borderRadius: 4, padding: '6px 10px', cursor: 'pointer', whiteSpace: 'nowrap' }
