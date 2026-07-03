import { useEffect, useState, useCallback } from 'react'
import { cardStyle, ErrorBanner, darkThStyle, darkTdStyle } from '../../ui/PageShell.js'
import { color, space, radius, fontSize, btn } from '../../ui/theme.js'
import { listMemory, updateMemory, deleteMemory, type MemoryRecord, type PersonaConfig } from '../../api/admin.js'

export function MemoryTab({ personas }: { personas: PersonaConfig[] }) {
  const [personaId, setPersonaId] = useState<string>(personas[0]?.id ?? '')
  const [kind, setKind] = useState<string>('')
  const [rows, setRows] = useState<MemoryRecord[]>([])
  const [err, setErr] = useState<string | null>(null)

  const [degraded, setDegraded] = useState(false)
  const load = useCallback(() => {
    setErr(null)
    listMemory({ personaId: personaId || undefined, kind: kind || undefined })
      .then(r => { setRows(r.items); setDegraded(r.degraded) })
      .catch(e => setErr('加载失败:' + (e as Error).message))
  }, [personaId, kind])
  useEffect(() => { load() }, [load])

  return (
    <div>
      <div style={{ display: 'flex', gap: space.md, marginBottom: space.md, alignItems: 'center', flexWrap: 'wrap' }}>
        <label style={{ color: color.textMuted, fontSize: fontSize.sm }}>角色
          <select style={sel} value={personaId} onChange={e => setPersonaId(e.target.value)}>
            {personas.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </label>
        <label style={{ color: color.textMuted, fontSize: fontSize.sm }}>类型
          <select style={sel} value={kind} onChange={e => setKind(e.target.value)}>
            <option value="">全部</option>
            <option value="fact">事实</option>
            <option value="insight">洞见</option>
            <option value="episode">片段</option>
          </select>
        </label>
      </div>
      {err && <ErrorBanner msg={err} />}
      {degraded && <ErrorBanner msg="记忆处于降级态(SurrealDB 未连接):当前记忆仅存内存,重启即失,且无语义检索" />}
      <div style={cardStyle}>
        {rows.length === 0 ? <p style={{ color: color.textFaint }}>(无记忆)</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm }}>
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
  // 允许空串临时态(用户清空再输入);保存前校验,避免 NaN 序列化成 null 提交。
  const [importance, setImportance] = useState<number | ''>(r.importance)
  const [editing, setEditing] = useState(false)
  const [rowErr, setRowErr] = useState<string | null>(null)
  const save = async () => {
    setRowErr(null)
    if (importance === '' || !Number.isFinite(importance)) { setRowErr('保存失败:重要度不是有效数字'); return }
    try { await updateMemory(r.id, { content, importance }); setEditing(false); onChanged() }
    catch (e) { setRowErr('保存失败:' + (e as Error).message) }
  }
  const del = async () => {
    if (!window.confirm('删除这条记忆?')) return
    setRowErr(null)
    try { await deleteMemory(r.id); onChanged() }
    catch (e) { setRowErr('删除失败:' + (e as Error).message) }
  }
  return (
    <tr>
      <td style={darkTdStyle}>{r.kind}</td>
      <td style={darkTdStyle}>{editing
        ? <input style={inp} value={content} onChange={e => setContent(e.target.value)} />
        : <span style={{ color: r.supersededAt ? color.textFaint : color.text, textDecoration: r.supersededAt ? 'line-through' : 'none' }}>{r.content}</span>}
        {rowErr && <div style={{ color: color.danger, fontSize: fontSize.xs, marginTop: space.xs }} role="alert">{rowErr}</div>}</td>
      <td style={darkTdStyle}>{editing
        ? <input style={{ ...inp, width: 56 }} type="number" min={1} max={5} value={importance} onChange={e => {
            const raw = e.target.value
            const n = Number(raw)
            // 仅在空串(临时态)或有限数时更新,过滤中间态产生的 NaN。
            if (raw === '' || Number.isFinite(n)) setImportance(raw === '' ? '' : n)
          }} />
        : r.importance}</td>
      <td style={darkTdStyle}>
        {editing
          ? <><button style={{ ...btn('primary', { size: 'sm' }), marginRight: space.sm }} onClick={save}>存</button><button style={btn('secondary', { size: 'sm' })} onClick={() => setEditing(false)}>取消</button></>
          : <><button style={{ ...btn('secondary', { size: 'sm' }), marginRight: space.sm }} onClick={() => setEditing(true)}>改</button><button style={btn('danger', { size: 'sm' })} onClick={del}>删</button></>}
      </td>
    </tr>
  )
}

const sel: React.CSSProperties = { marginLeft: space.sm, padding: '5px 8px', background: color.surfaceAlt, color: color.text, border: `1px solid ${color.border}`, borderRadius: radius.md, fontFamily: 'inherit' }
const inp: React.CSSProperties = { width: '100%', padding: '4px 6px', background: color.surfaceAlt, color: color.text, border: `1px solid ${color.border}`, borderRadius: radius.md, fontFamily: 'inherit', boxSizing: 'border-box' }
