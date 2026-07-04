import { useEffect, useState, useCallback } from 'react'
import { PageShell, ErrorBanner, headingStyle } from '../../ui/PageShell.js'
import { color, space, radius, fontSize, font } from '../../ui/theme.js'
import { getConfig, type ConfigPayload } from '../../api/admin.js'
import { KeysModelsTab } from './KeysModelsTab.js'
import { PersonasTab } from './PersonasTab.js'
import { ParamsTab } from './ParamsTab.js'
import { MemoryTab } from './MemoryTab.js'
import { GamesTab } from './GamesTab.js'

type Tab = 'personas' | 'keys' | 'params' | 'memory' | 'games'
const TABS: { id: Tab; label: string }[] = [
  { id: 'personas', label: '角色' },
  { id: 'keys', label: '密钥与模型' },
  { id: 'params', label: '运行参数' },
  { id: 'memory', label: '记忆' },
  { id: 'games', label: '对局与消息' },
]

export function ConsolePage() {
  const [tab, setTab] = useState<Tab>('personas')
  const [cfg, setCfg] = useState<ConfigPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [version, setVersion] = useState(0)

  const reload = useCallback(() => {
    setLoading(true); setErr(null)
    getConfig()
      .then(d => { setCfg(d); setVersion(v => v + 1) })
      .catch((e: Error) => setErr('加载失败,请确认后端在运行(' + e.message + ')'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  return (
    <PageShell>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ ...headingStyle, fontSize: fontSize.xl, marginBottom: space.lg }}>控制台</h1>
        <div style={tabBar}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ ...tabBtn, ...(tab === t.id ? tabActive : {}) }}>{t.label}</button>
          ))}
        </div>

        {err && <ErrorBanner msg={err} />}
        {loading && !err && <p style={{ color: color.textMuted }}>加载中…</p>}

        {!loading && !err && cfg && (
          <div style={{ marginTop: space.lg }}>
            {tab === 'personas' && <PersonasTab key={version} personas={cfg.personas} onChanged={reload} />}
            {tab === 'keys' && <KeysModelsTab key={version} llm={cfg.llm} onChanged={reload} />}
            {tab === 'params' && <ParamsTab key={version} chat={cfg.chat} director={cfg.director} engine={cfg.engine} diagnose={cfg.diagnose} onChanged={reload} />}
            {tab === 'memory' && <MemoryTab personas={cfg.personas} />}
            {tab === 'games' && <GamesTab />}
          </div>
        )}
      </div>
    </PageShell>
  )
}

const tabBar: React.CSSProperties = {
  display: 'flex', gap: space.sm, flexWrap: 'wrap',
  borderBottom: `1px solid ${color.border}`, paddingBottom: space.sm,
}
const tabBtn: React.CSSProperties = {
  background: 'transparent', color: color.textMuted, border: `1px solid ${color.border}`,
  borderRadius: radius.md, padding: `${space.sm}px ${space.lg}px`, cursor: 'pointer',
  fontSize: fontSize.base, fontFamily: font.sans, fontWeight: 500, transition: 'all .15s',
}
const tabActive: React.CSSProperties = {
  color: color.onGold, background: color.gold, borderColor: color.gold, fontWeight: 700,
}
