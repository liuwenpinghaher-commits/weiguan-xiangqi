import { useEffect, useState, useCallback } from 'react'
import { cardStyle, ErrorBanner, darkThStyle, darkTdStyle } from '../../ui/PageShell.js'
import { color, space, fontSize, btn } from '../../ui/theme.js'
import { listGames, getGame, deleteGame, importGame, type GameRow, type GameDetail } from '../../api/admin.js'

export function GamesTab() {
  const [rows, setRows] = useState<GameRow[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [detail, setDetail] = useState<GameDetail | null>(null)

  const load = useCallback(() => {
    setErr(null)
    listGames().then(setRows).catch(e => setErr('加载失败:' + (e as Error).message))
  }, [])
  useEffect(() => { load() }, [load])

  const open = async (id: number) => { try { setDetail(await getGame(id)) } catch (e) { setErr('详情加载失败:' + (e as Error).message) } }
  const doImport = async (file: File) => {
    setErr(null)
    try {
      const data = JSON.parse(await file.text())
      const { gameId } = await importGame(data)
      window.alert(`导入成功:对局 #${gameId}(可到分析页跑诊断以进入成长统计)`)
      load()
    } catch (e) { setErr('导入失败:' + (e as Error).message) }
  }

  const del = async (id: number) => {
    if (!window.confirm(`删除对局 #${id} 及其全部走法/消息?`)) return
    try { await deleteGame(id); if (detail?.game.id === id) setDetail(null); load() } catch (e) { setErr('删除失败:' + (e as Error).message) }
  }

  return (
    <div>
      {err && <ErrorBanner msg={err} />}
      <div style={{ marginBottom: space.md }}>
        <label style={{ ...btn('secondary'), display: 'inline-block', cursor: 'pointer' }}>
          导入棋谱 JSON
          <input type="file" accept="application/json,.json" style={{ display: 'none' }}
            onChange={e => { const f = e.target.files?.[0]; if (f) void doImport(f); e.target.value = '' }} />
        </label>
      </div>
      <div style={cardStyle}>
        {rows.length === 0 ? <p style={{ color: color.textFaint }}>(无对局)</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: fontSize.sm }}>
            <thead><tr><th style={darkThStyle}>#</th><th style={darkThStyle}>开始</th><th style={darkThStyle}>模式</th><th style={darkThStyle}>结果</th><th style={darkThStyle}>操作</th></tr></thead>
            <tbody>{rows.map(g => (
              <tr key={g.id}>
                <td style={darkTdStyle}>{g.id}</td>
                <td style={darkTdStyle}>{g.startedAt?.slice(0, 19).replace('T', ' ')}</td>
                <td style={darkTdStyle}>{g.mode}</td>
                <td style={darkTdStyle}>{g.result ?? '进行中'}</td>
                <td style={darkTdStyle}>
                  <button style={{ ...btn('secondary', { size: 'sm' }), marginRight: space.sm }} onClick={() => open(g.id)}>查看</button>
                  <button style={btn('danger', { size: 'sm' })} onClick={() => del(g.id)}>删</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {detail && (
        <div style={{ ...cardStyle, marginTop: space.lg }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: color.gold, margin: 0, fontSize: fontSize.md }}>对局 #{detail.game.id}</h3>
            <button style={btn('secondary', { size: 'sm' })} onClick={() => setDetail(null)}>关闭</button>
          </div>
          <p style={{ color: color.textMuted, fontSize: fontSize.sm }}>走法 {detail.moves.length} 步,消息 {detail.messages.length} 条</p>
          <div style={{ maxHeight: 240, overflow: 'auto', fontSize: fontSize.sm, color: color.text }}>
            {detail.messages.map((m: any, i: number) => <div key={i}><b style={{ color: color.gold }}>{m.personaId}</b>: {m.text}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}
