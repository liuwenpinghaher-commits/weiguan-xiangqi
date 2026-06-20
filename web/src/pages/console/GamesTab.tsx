import { useEffect, useState, useCallback } from 'react'
import { cardStyle, ErrorBanner, darkThStyle, darkTdStyle } from '../../ui/PageShell.js'
import { listGames, getGame, deleteGame, type GameRow, type GameDetail } from '../../api/admin.js'

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
  const del = async (id: number) => {
    if (!window.confirm(`删除对局 #${id} 及其全部走法/消息?`)) return
    try { await deleteGame(id); if (detail?.game.id === id) setDetail(null); load() } catch (e) { setErr('删除失败:' + (e as Error).message) }
  }

  return (
    <div>
      {err && <ErrorBanner msg={err} />}
      <div style={cardStyle}>
        {rows.length === 0 ? <p style={{ color: '#888' }}>(无对局)</p> : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead><tr><th style={darkThStyle}>#</th><th style={darkThStyle}>开始</th><th style={darkThStyle}>模式</th><th style={darkThStyle}>结果</th><th style={darkThStyle}>操作</th></tr></thead>
            <tbody>{rows.map(g => (
              <tr key={g.id}>
                <td style={darkTdStyle}>{g.id}</td>
                <td style={darkTdStyle}>{g.startedAt?.slice(0, 19).replace('T', ' ')}</td>
                <td style={darkTdStyle}>{g.mode}</td>
                <td style={darkTdStyle}>{g.result ?? '进行中'}</td>
                <td style={darkTdStyle}>
                  <button style={btnGhostSm} onClick={() => open(g.id)}>查看</button>
                  <button style={btnDel} onClick={() => del(g.id)}>删</button>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>

      {detail && (
        <div style={{ ...cardStyle, marginTop: 16 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ color: '#f5c518', margin: 0, fontSize: '1rem' }}>对局 #{detail.game.id}</h3>
            <button style={btnGhostSm} onClick={() => setDetail(null)}>关闭</button>
          </div>
          <p style={{ color: '#aaa', fontSize: '0.82rem' }}>走法 {detail.moves.length} 步,消息 {detail.messages.length} 条</p>
          <div style={{ maxHeight: 240, overflow: 'auto', fontSize: '0.82rem', color: '#ccc' }}>
            {detail.messages.map((m: any, i: number) => <div key={i}><b style={{ color: '#f5c518' }}>{m.personaId}</b>: {m.text}</div>)}
          </div>
        </div>
      )}
    </div>
  )
}

const btnGhostSm: React.CSSProperties = { background: 'transparent', color: '#bbb', border: '1px solid #333', borderRadius: 4, padding: '3px 10px', cursor: 'pointer', marginRight: 6 }
const btnDel: React.CSSProperties = { background: 'transparent', color: '#ff6b6b', border: '1px solid rgba(255,82,82,0.4)', borderRadius: 4, padding: '3px 10px', cursor: 'pointer' }
