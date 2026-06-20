import { useEffect, useState, useCallback } from 'react'
import { cardStyle, ErrorBanner, darkThStyle, darkTdStyle } from '../../ui/PageShell.js'
import { listMemory, updateMemory, deleteMemory, type MemoryRecord, type PersonaConfig } from '../../api/admin.js'

export function MemoryTab({ personas }: { personas: PersonaConfig[] }) {
  const [personaId, setPersonaId] = useState<string>(personas[0]?.id ?? '')
  const [kind, setKind] = useState<string>('')
  const [rows, setRows] = useState<MemoryRecord[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = useCallback(() => {
    setErr(null)
    listMemory({ personaId: personaId || undefined, kind: kind || undefined })
      .then(setRows)
      .catch(e => setErr('加载失败:' + (e as Error).message))
  }, [personaId, kind])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <div style={{ display: 'flex', gap: 12, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ color: '#ccc', fontSize: '0.85rem' }}>角色
          <select style={sel} value={personaId} onChange={e => setPersonaId(e.target.value)}>
            {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ color: '#ccc', fontSize: '0.85rem' }}>类型
          <select style={sel} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">全部</option>
            <option value="fact">事实</option>
            <option value="insight">洞见</option>
            <option value="episode">片段</option>
          </select>
        </label>
      </div>
      {err && <ErrorBanner msg={err} />}
      <div style={cardStyle}>
        {rows.length === 0 ? <p style={{ color: '#888' }}>(无记忆)</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr><th style={darkThStyle}>类型</th><th style={darkThStyle}>内容</th><th style={darkThStyle}>重要度</th><th style={darkThStyle}>操作</th></tr></thead>
            <tbody>{rows.map(r => <MemRow key={r.id} r={r} onChanged={load} />)}</tbody>
          </table>
        )}
      </div>
    </div>
  )
}

function MemRow({ r, onChanged }: { r: MemoryRecord; onChanged: () => void }) {
  const [content, setContent] = useState(r.content)
  const [importance, setImportance] = useState(r.importance)
  const [editing, setEditing] = useState(false)
  const save = async () => { await updateMemory(r.id, { content, importance }); setEditing(false); onChanged() }
  const del = async () => { if (window.confirm('删除这条记忆?')) { await deleteMemory(r.id); onChanged() } }
  return (
    <tr>
      <td style={darkTdStyle}>{r.kind}</td>
      <td style={darkTdStyle}>{editing
        ? <input style={inp} value={content} onChange={e => setContent(e.target.value)} />
        : <span style={{ color: r.supersededAt ? '#777' : '#eee', textDecoration: r.supersededAt ? 'line-through' : 'none' }}>{r.content}</span>}</td>
      <td style={darkTdStyle}>{editing
        ? <input style={{ ...inp, width: 56 }} type="number" min={1} max={5} value={importance} onChange={e => setImportance(Number(e.target.value))} />
        : r.importance}</td>
      <td style={darkTdStyle}>
        {editing
          ? <><button style={btnSm} onClick={save}>存</button><button style={btnGhostSm} onClick={() => setEditing(false)}>取消</button></>
          : <><button style={btnGhostSm} onClick={() => setEditing(true)}>改</button><button style={btnDel} onClick={del}>删</button></>}
      </td>
    </tr>
  )
}

const sel: React.CSSProperties = { marginLeft: 6, padding: '5px 8px', background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 4, fontFamily: 'inherit' }
const inp: React.CSSProperties = { width: '100%', padding: '4px 6px', background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }
const btnSm: React.CSSProperties = { background: '#f5c518', color: '#1a1a2e', border: 'none', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', marginRight: 6 }
const btnGhostSm: React.CSSProperties = { background: 'transparent', color: '#bbb', border: '1px solid #333', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', marginRight: 6 }
const btnDel: React.CSSProperties = { background: 'transparent', color: '#ff6b6b', border: '1px solid rgba(255,82,82,0.4)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }
