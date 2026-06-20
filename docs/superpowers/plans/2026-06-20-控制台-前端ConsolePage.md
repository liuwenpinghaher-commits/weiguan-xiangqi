# 控制台 · 前端 ConsolePage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在现有 Web 应用加 `#/console` 控制台页:5 标签页(角色 / 密钥与模型 / 运行参数 / 记忆 / 对局与消息),对接已就绪的后端 `/admin/*` 路由,做配置的展示与即时编辑。

**Architecture:** 把所有网络逻辑收进可单测的 `web/src/api/admin.ts`(fetch 客户端 + 类型),把表单字段定义/音色表/脱敏显示等纯逻辑收进可单测的 `web/src/pages/console/console-data.ts`;React 组件保持"薄"——只把数据/helper 接到 JSX。组件在 node 环境的 vitest 下无法渲染测试,故以 `typecheck + build` 为闸门 + 末尾人工目检。沿用现有 `PageShell`/`ErrorBanner` 暗色风与内联 `React.CSSProperties`。

**Tech Stack:** React 18、TypeScript(ESM,`.js` import 后缀)、Vite、vitest(node 环境,纯逻辑单测;组件靠 tsc+build)。后端 `/admin/*`(已合入 main)、`@fastify/cors` 已开,前端 `HTTP_BASE='http://localhost:3410'` 直连。

参考 spec:[2026-06-20-控制台配置管理-design.md](../specs/2026-06-20-控制台配置管理-design.md) §5(路由)、§6(前端)。后端契约见已合入的 `server/src/admin/admin-routes.ts`。

---

## 后端契约速查(本计划据此对接,勿改后端)

- `GET /admin/config` → `{ chat, director, engine, diagnose, llm:{apiKey(脱敏), model, baseURL}, tts, personas: PersonaConfig[] }`
- `GET /admin/config/llm/reveal` → `{ apiKey }`(完整 key)
- `PUT /admin/config/:section`(body=该段部分字段)→ `{ ok:true }`;未知 section→400
- `GET /admin/personas` → `PersonaConfig[]`;`PUT /admin/personas/:id`(body 部分字段)→`{ok:true}`;`POST /admin/personas/:id/reset`→`{ok:true}`
- `GET /admin/memory?personaId=&kind=&includeSuperseded=` → `MemoryRecord[]`;`PUT /admin/memory/:id`(body `{content?,importance?}`)→`{ok:true}`;`DELETE /admin/memory/:id`→`{ok:true}`
- `GET /admin/games` → `GameRow[]`;`GET /admin/games/:id` → `{game, moves, messages}`;`DELETE /admin/games/:id`→`{ok:true}`

类型形状(前端镜像):
```ts
PersonaConfig = { id:string; name:string; isPlayer:boolean; skill:string; background:string; voiceStyle:string; leaning:string; ttsVoice:string; enabled:boolean }
MemoryRecord = { id:string; personaId:string; kind:'episode'|'fact'|'insight'; content:string; importance:number; gameId:number|null; createdAt:string; supersededAt:string|null }
GameRow = { id:number; startedAt:string; endedAt:string|null; mode:string; humanSide:string; result:string|null; startFen:string }
ChatCfg = { minSilenceMs,maxPerMin,speakThreshold,jitterWidth,idleProb,idleIntervalMs,reactProb,lenShortP,lenLongP : number }
DirectorModeCfg = { maxDropCp:number; targetBand:{low:number;high:number}; strength:number }
DirectorCfg = { coach:DirectorModeCfg; humanlike:DirectorModeCfg }
EngineCfg = { pikafishPath:string|null; multipv:number; movetime:number }
DiagnoseCfg = { depth:number }
LlmCfg = { apiKey:string; model:string; baseURL:string|null }   // GET 时 apiKey 已脱敏
TtsCfg = { endpoint:string; model:string }
```

---

## 文件结构

**新建**
- `web/src/api/admin.ts` — admin 客户端(全部 `/admin/*` 调用 + 类型)。可单测。
- `web/src/api/admin.test.ts` — fetch 打桩单测。
- `web/src/pages/console/console-data.ts` — 纯数据/helper:`VOICES`、各段数值字段定义 `PARAM_FIELDS`、`displayMaskedKey`。可单测。
- `web/src/pages/console/console-data.test.ts` — 纯逻辑单测。
- `web/src/pages/console/ConsolePage.tsx` — 页壳 + 标签切换 + 顶层 `GET /admin/config` 加载。
- `web/src/pages/console/KeysModelsTab.tsx` — 密钥与模型(llm + tts)。
- `web/src/pages/console/PersonasTab.tsx` — 角色。
- `web/src/pages/console/ParamsTab.tsx` — 运行参数(chat/director/engine/diagnose)。
- `web/src/pages/console/MemoryTab.tsx` — 记忆。
- `web/src/pages/console/GamesTab.tsx` — 对局与消息。

**修改**
- `web/src/main.tsx` — Route 联合加 `console`、import ConsolePage、App switch 加分支、Nav 加入口链接。

约定:全部内联 `React.CSSProperties`;复用 `PageShell`/`ErrorBanner`/`cardStyle`/`headingStyle`/`darkThStyle`/`darkTrStyle`/`darkTdStyle`(来自 `../../ui/PageShell.js`);色板 bg `#1a1a2e`、金 `#f5c518`、卡 `rgba(255,255,255,0.05)`、错 `#ff6b6b`、成功 `#8bc34a`。

---

## Task 1: admin API 客户端

**Files:**
- Create: `web/src/api/admin.ts`
- Test: `web/src/api/admin.test.ts`

- [ ] **Step 1: 写失败测试(打桩 global.fetch)**

`web/src/api/admin.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as admin from './admin.js'

function stub(json: unknown, ok = true, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({ ok, status, json: async () => json } as Response))
}

describe('admin client', () => {
  const orig = globalThis.fetch
  beforeEach(() => {})
  afterEach(() => { globalThis.fetch = orig })

  it('getConfig 打到 /admin/config 并返回 body', async () => {
    globalThis.fetch = stub({ chat: { maxPerMin: 12 }, personas: [] }) as any
    const cfg = await admin.getConfig()
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/config')
    expect(cfg.chat.maxPerMin).toBe(12)
  })

  it('revealLlmKey 打到 reveal 端点', async () => {
    globalThis.fetch = stub({ apiKey: 'sk-real' }) as any
    expect((await admin.revealLlmKey()).apiKey).toBe('sk-real')
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/config/llm/reveal')
  })

  it('putSection 发 PUT + JSON body', async () => {
    globalThis.fetch = stub({ ok: true }) as any
    await admin.putSection('chat', { speakThreshold: 0.8 })
    const [url, init] = (globalThis.fetch as any).mock.calls[0]
    expect(url).toBe('http://localhost:3410/admin/config/chat')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ speakThreshold: 0.8 })
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('putPersona / resetPersona / updateMemory / deleteMemory / deleteGame 用对的 method+url', async () => {
    globalThis.fetch = stub({ ok: true }) as any
    await admin.putPersona('coach', { ttsVoice: 'Cherry' })
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/personas/coach')
    expect((globalThis.fetch as any).mock.calls[0][1].method).toBe('PUT')

    await admin.resetPersona('coach')
    expect((globalThis.fetch as any).mock.calls[1][0]).toBe('http://localhost:3410/admin/personas/coach/reset')
    expect((globalThis.fetch as any).mock.calls[1][1].method).toBe('POST')

    await admin.updateMemory('mem:1', { content: 'x' })
    expect((globalThis.fetch as any).mock.calls[2][0]).toBe('http://localhost:3410/admin/memory/mem%3A1')
    expect((globalThis.fetch as any).mock.calls[2][1].method).toBe('PUT')

    await admin.deleteMemory('mem:1')
    expect((globalThis.fetch as any).mock.calls[3][1].method).toBe('DELETE')

    await admin.deleteGame(7)
    expect((globalThis.fetch as any).mock.calls[4][0]).toBe('http://localhost:3410/admin/games/7')
    expect((globalThis.fetch as any).mock.calls[4][1].method).toBe('DELETE')
  })

  it('listMemory 拼 query', async () => {
    globalThis.fetch = stub([]) as any
    await admin.listMemory({ personaId: 'coach', kind: 'fact' })
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/memory?personaId=coach&kind=fact')
  })

  it('非 2xx 抛错', async () => {
    globalThis.fetch = stub({ error: 'bad' }, false, 400) as any
    await expect(admin.getConfig()).rejects.toThrow(/400/)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm -w web test -- admin`
Expected: FAIL —— 找不到 `./admin.js`。

- [ ] **Step 3: 写实现**

`web/src/api/admin.ts`:
```ts
import { HTTP_BASE as BASE } from './config.js'

export interface PersonaConfig {
  id: string; name: string; isPlayer: boolean; skill: string
  background: string; voiceStyle: string; leaning: string; ttsVoice: string; enabled: boolean
}
export interface MemoryRecord {
  id: string; personaId: string; kind: 'episode' | 'fact' | 'insight'
  content: string; importance: number; gameId: number | null; createdAt: string; supersededAt: string | null
}
export interface GameRow {
  id: number; startedAt: string; endedAt: string | null; mode: string; humanSide: string; result: string | null; startFen: string
}
export interface ChatCfg {
  minSilenceMs: number; maxPerMin: number; speakThreshold: number; jitterWidth: number
  idleProb: number; idleIntervalMs: number; reactProb: number; lenShortP: number; lenLongP: number
}
export interface DirectorModeCfg { maxDropCp: number; targetBand: { low: number; high: number }; strength: number }
export interface DirectorCfg { coach: DirectorModeCfg; humanlike: DirectorModeCfg }
export interface EngineCfg { pikafishPath: string | null; multipv: number; movetime: number }
export interface DiagnoseCfg { depth: number }
export interface LlmCfg { apiKey: string; model: string; baseURL: string | null }
export interface TtsCfg { endpoint: string; model: string }
export interface ConfigPayload {
  chat: ChatCfg; director: DirectorCfg; engine: EngineCfg; diagnose: DiagnoseCfg
  llm: LlmCfg; tts: TtsCfg; personas: PersonaConfig[]
}
export type ConfigSection = 'chat' | 'director' | 'engine' | 'diagnose' | 'llm' | 'tts'
export interface GameDetail { game: GameRow; moves: any[]; messages: any[] }

async function jget(path: string): Promise<any> {
  const r = await fetch(`${BASE}${path}`)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}
async function jsend(path: string, method: 'PUT' | 'POST' | 'DELETE', body?: unknown): Promise<any> {
  const init: RequestInit = { method }
  if (body !== undefined) {
    init.body = JSON.stringify(body)
    init.headers = { 'Content-Type': 'application/json' }
  }
  const r = await fetch(`${BASE}${path}`, init)
  if (!r.ok) throw new Error(`${path} → ${r.status}`)
  return r.json()
}

export const getConfig = (): Promise<ConfigPayload> => jget('/admin/config')
export const revealLlmKey = (): Promise<{ apiKey: string }> => jget('/admin/config/llm/reveal')
export const putSection = (section: ConfigSection, patch: Record<string, unknown>): Promise<{ ok: true }> =>
  jsend(`/admin/config/${section}`, 'PUT', patch)

export const getPersonas = (): Promise<PersonaConfig[]> => jget('/admin/personas')
export const putPersona = (id: string, patch: Partial<Omit<PersonaConfig, 'id'>>): Promise<{ ok: true }> =>
  jsend(`/admin/personas/${id}`, 'PUT', patch)
export const resetPersona = (id: string): Promise<{ ok: true }> => jsend(`/admin/personas/${id}/reset`, 'POST')

export const listMemory = (q: { personaId?: string; kind?: string; includeSuperseded?: boolean }): Promise<MemoryRecord[]> => {
  const p = new URLSearchParams()
  if (q.personaId) p.set('personaId', q.personaId)
  if (q.kind) p.set('kind', q.kind)
  if (q.includeSuperseded) p.set('includeSuperseded', 'true')
  const qs = p.toString()
  return jget(`/admin/memory${qs ? `?${qs}` : ''}`)
}
export const updateMemory = (id: string, patch: { content?: string; importance?: number }): Promise<{ ok: true }> =>
  jsend(`/admin/memory/${encodeURIComponent(id)}`, 'PUT', patch)
export const deleteMemory = (id: string): Promise<{ ok: true }> =>
  jsend(`/admin/memory/${encodeURIComponent(id)}`, 'DELETE')

export const listGames = (): Promise<GameRow[]> => jget('/admin/games')
export const getGame = (id: number): Promise<GameDetail> => jget(`/admin/games/${id}`)
export const deleteGame = (id: number): Promise<{ ok: true }> => jsend(`/admin/games/${id}`, 'DELETE')
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm -w web test -- admin`
Expected: PASS(7 个用例)。

- [ ] **Step 5: typecheck**

Run: `npm -w web run typecheck`
Expected: 无错误。

- [ ] **Step 6: Commit**

```bash
git add web/src/api/admin.ts web/src/api/admin.test.ts
git commit -m "feat(console): admin API 客户端 + 类型(fetch 打桩单测)"
```

---

## Task 2: 纯数据/helper(音色表 / 参数字段定义 / 脱敏显示)

**Files:**
- Create: `web/src/pages/console/console-data.ts`
- Test: `web/src/pages/console/console-data.test.ts`

- [ ] **Step 1: 写失败测试**

`web/src/pages/console/console-data.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { VOICES, PARAM_FIELDS, displayMaskedKey } from './console-data.js'

describe('console-data', () => {
  it('VOICES 含已验证可用音色', () => {
    const ids = VOICES.map(v => v.id)
    for (const id of ['Dylan', 'Ethan', 'Serena', 'Eric', 'Cherry', 'Chelsie', 'Kiki', 'Rocky', 'Jada', 'Sunny']) {
      expect(ids).toContain(id)
    }
  })
  it('PARAM_FIELDS 覆盖 chat/engine/diagnose 段,每字段有 label/min/max', () => {
    expect(PARAM_FIELDS.chat.length).toBeGreaterThan(0)
    expect(PARAM_FIELDS.engine.length).toBeGreaterThan(0)
    expect(PARAM_FIELDS.diagnose.length).toBeGreaterThan(0)
    for (const f of PARAM_FIELDS.chat) {
      expect(typeof f.label).toBe('string')
      expect(typeof f.min).toBe('number')
      expect(typeof f.max).toBe('number')
      expect(typeof f.key).toBe('string')
    }
  })
  it('displayMaskedKey 空值显示占位', () => {
    expect(displayMaskedKey('')).toBe('(未设置)')
    expect(displayMaskedKey('sk-****1Xqy')).toBe('sk-****1Xqy')
  })
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm -w web test -- console-data`
Expected: FAIL —— 找不到 `./console-data.js`。

- [ ] **Step 3: 写实现**

`web/src/pages/console/console-data.ts`:
```ts
/** qwen3-tts-flash 已验证可用音色(spec §6) */
export const VOICES: { id: string; label: string }[] = [
  { id: 'Dylan', label: 'Dylan(北京话)' },
  { id: 'Ethan', label: 'Ethan' },
  { id: 'Serena', label: 'Serena' },
  { id: 'Eric', label: 'Eric' },
  { id: 'Cherry', label: 'Cherry' },
  { id: 'Chelsie', label: 'Chelsie' },
  { id: 'Kiki', label: 'Kiki' },
  { id: 'Rocky', label: 'Rocky' },
  { id: 'Jada', label: 'Jada(沪语)' },
  { id: 'Sunny', label: 'Sunny(四川话)' },
]

export interface ParamField { key: string; label: string; min: number; max: number; step: number; help?: string }

/** 各数值参数段的字段定义(范围与后端 validateSection 钳制范围一致) */
export const PARAM_FIELDS: Record<'chat' | 'engine' | 'diagnose', ParamField[]> = {
  chat: [
    { key: 'minSilenceMs', label: '最短静默(ms)', min: 0, max: 60000, step: 500, help: '两次群聊之间的最短间隔' },
    { key: 'maxPerMin', label: '每分钟上限(条)', min: 0, max: 120, step: 1 },
    { key: 'speakThreshold', label: '发言阈值', min: 0, max: 1, step: 0.05, help: '综合分高于此值才发言' },
    { key: 'jitterWidth', label: '随机抖动宽度', min: 0, max: 2, step: 0.05 },
    { key: 'idleProb', label: '冷场触发概率', min: 0, max: 1, step: 0.05 },
    { key: 'idleIntervalMs', label: '冷场检测间隔(ms)', min: 0, max: 120000, step: 1000 },
    { key: 'reactProb', label: '互相搭话概率', min: 0, max: 1, step: 0.05 },
    { key: 'lenShortP', label: '短句档概率上界', min: 0, max: 1, step: 0.05, help: '<此值出短句' },
    { key: 'lenLongP', label: '中句档概率上界', min: 0, max: 1, step: 0.05, help: '>此值出稍长句' },
  ],
  engine: [
    { key: 'multipv', label: '候选着法数(MultiPV)', min: 1, max: 10, step: 1 },
    { key: 'movetime', label: '每步思考(ms)', min: 50, max: 5000, step: 50 },
  ],
  diagnose: [
    { key: 'depth', label: '诊断深度', min: 1, max: 30, step: 1 },
  ],
}

/** 脱敏 key 的展示:空显示占位,否则原样(后端已脱敏) */
export function displayMaskedKey(masked: string): string {
  return masked && masked.trim() !== '' ? masked : '(未设置)'
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm -w web test -- console-data`
Expected: PASS(3 个用例)。

- [ ] **Step 5: Commit**

```bash
git add web/src/pages/console/console-data.ts web/src/pages/console/console-data.test.ts
git commit -m "feat(console): 音色表 + 参数字段定义 + 脱敏显示 helper(纯逻辑单测)"
```

---

## Task 3: ConsolePage 页壳 + 标签切换 + 顶层加载

**Files:**
- Create: `web/src/pages/console/ConsolePage.tsx`

组件测试在 node 环境无法渲染,故本任务闸门为 `typecheck + build`。

- [ ] **Step 1: 写组件**

`web/src/pages/console/ConsolePage.tsx`:
```tsx
import { useEffect, useState, useCallback } from 'react'
import { PageShell, ErrorBanner, headingStyle } from '../../ui/PageShell.js'
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

  const reload = useCallback(() => {
    setLoading(true); setErr(null)
    getConfig()
      .then(setCfg)
      .catch((e: Error) => setErr('加载失败,请确认后端在运行(' + e.message + ')'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload() }, [reload])

  return (
    <PageShell>
      <div style={{ maxWidth: 860, margin: '0 auto' }}>
        <h1 style={{ ...headingStyle, fontSize: '1.6rem', marginBottom: 16 }}>控制台</h1>
        <div style={tabBar}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ ...tabBtn, ...(tab === t.id ? tabActive : {}) }}>{t.label}</button>
          ))}
        </div>

        {err && <ErrorBanner msg={err} />}
        {loading && !err && <p style={{ color: '#aaa' }}>加载中…</p>}

        {!loading && !err && cfg && (
          <div style={{ marginTop: 16 }}>
            {tab === 'personas' && <PersonasTab personas={cfg.personas} onChanged={reload} />}
            {tab === 'keys' && <KeysModelsTab llm={cfg.llm} tts={cfg.tts} onChanged={reload} />}
            {tab === 'params' && <ParamsTab chat={cfg.chat} director={cfg.director} engine={cfg.engine} diagnose={cfg.diagnose} onChanged={reload} />}
            {tab === 'memory' && <MemoryTab personas={cfg.personas} />}
            {tab === 'games' && <GamesTab />}
          </div>
        )}
      </div>
    </PageShell>
  )
}

const tabBar: React.CSSProperties = { display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid #333', paddingBottom: 8 }
const tabBtn: React.CSSProperties = {
  background: 'transparent', color: '#bbb', border: '1px solid #333', borderRadius: 6,
  padding: '6px 14px', cursor: 'pointer', fontSize: '0.9rem', fontFamily: 'inherit',
}
const tabActive: React.CSSProperties = { color: '#1a1a2e', background: '#f5c518', borderColor: '#f5c518', fontWeight: 700 }
```

- [ ] **Step 2: 占位子组件(让本任务可编译)**

为让 Task 3 单独编译通过,先建 5 个最小占位组件(Task 4–8 会写完整实现)。新建各文件,内容均为最小骨架,例如 `web/src/pages/console/KeysModelsTab.tsx`:
```tsx
import type { LlmCfg, TtsCfg } from '../../api/admin.js'
export function KeysModelsTab(_props: { llm: LlmCfg; tts: TtsCfg; onChanged: () => void }) {
  return <div>密钥与模型(待实现)</div>
}
```
同样建占位:
- `PersonasTab.tsx`:`export function PersonasTab(_props: { personas: import('../../api/admin.js').PersonaConfig[]; onChanged: () => void }) { return <div>角色(待实现)</div> }`
- `ParamsTab.tsx`:`export function ParamsTab(_props: { chat: import('../../api/admin.js').ChatCfg; director: import('../../api/admin.js').DirectorCfg; engine: import('../../api/admin.js').EngineCfg; diagnose: import('../../api/admin.js').DiagnoseCfg; onChanged: () => void }) { return <div>运行参数(待实现)</div> }`
- `MemoryTab.tsx`:`export function MemoryTab(_props: { personas: import('../../api/admin.js').PersonaConfig[] }) { return <div>记忆(待实现)</div> }`
- `GamesTab.tsx`:`export function GamesTab() { return <div>对局与消息(待实现)</div> }`

(占位是有意的渐进式,Task 4–8 各自替换为完整实现。)

- [ ] **Step 3: typecheck + build**

Run: `npm -w web run typecheck && npm -w web run build`
Expected: 均无错误。

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/console/ConsolePage.tsx web/src/pages/console/KeysModelsTab.tsx web/src/pages/console/PersonasTab.tsx web/src/pages/console/ParamsTab.tsx web/src/pages/console/MemoryTab.tsx web/src/pages/console/GamesTab.tsx
git commit -m "feat(console): ConsolePage 页壳 + 5 标签切换 + 顶层加载(子标签占位)"
```

---

## Task 4: 密钥与模型标签

**Files:**
- Modify: `web/src/pages/console/KeysModelsTab.tsx`(替换占位)

- [ ] **Step 1: 写完整组件**

`web/src/pages/console/KeysModelsTab.tsx`:
```tsx
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
```

- [ ] **Step 2: typecheck + build**

Run: `npm -w web run typecheck && npm -w web run build`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/console/KeysModelsTab.tsx
git commit -m "feat(console): 密钥与模型标签(key 脱敏占位 + 显示当前 + LLM/TTS 保存)"
```

---

## Task 5: 角色标签

**Files:**
- Modify: `web/src/pages/console/PersonasTab.tsx`(替换占位)

- [ ] **Step 1: 写完整组件**

`web/src/pages/console/PersonasTab.tsx`:
```tsx
import { useState } from 'react'
import { cardStyle } from '../../ui/PageShell.js'
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
    <div style={{ ...cardStyle, marginBottom: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h3 style={{ color: '#f5c518', margin: 0, fontSize: '1rem' }}>{p.id}{p.isPlayer ? '(棋手)' : '(观棋)'}</h3>
        <label style={{ color: '#ccc', fontSize: '0.82rem' }}>
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
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <button style={btn} onClick={save}>保存</button>
        <button style={btnGhost} onClick={reset}>恢复默认</button>
        {msg && <span style={{ color: msg.includes('失败') ? '#ff6b6b' : '#8bc34a', fontSize: '0.82rem' }}>{msg}</span>}
      </div>
    </div>
  )
}

const lbl: React.CSSProperties = { display: 'block', color: '#ccc', fontSize: '0.85rem', marginBottom: 10 }
const inp: React.CSSProperties = { display: 'block', width: '100%', marginTop: 4, padding: '6px 8px', background: '#0f0f1e', color: '#eee', border: '1px solid #333', borderRadius: 4, fontFamily: 'inherit', boxSizing: 'border-box' }
const btn: React.CSSProperties = { background: '#f5c518', color: '#1a1a2e', border: 'none', borderRadius: 6, padding: '7px 18px', cursor: 'pointer', fontWeight: 700 }
const btnGhost: React.CSSProperties = { background: 'transparent', color: '#bbb', border: '1px solid #333', borderRadius: 4, padding: '6px 12px', cursor: 'pointer' }
```

- [ ] **Step 2: typecheck + build**

Run: `npm -w web run typecheck && npm -w web run build`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/console/PersonasTab.tsx
git commit -m "feat(console): 角色标签(逐角色名/背景/口吻/倾向/音色下拉/启用 + 保存/恢复默认)"
```

---

## Task 6: 运行参数标签

**Files:**
- Modify: `web/src/pages/console/ParamsTab.tsx`(替换占位)

- [ ] **Step 1: 写完整组件**

`web/src/pages/console/ParamsTab.tsx`:
```tsx
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
```

- [ ] **Step 2: typecheck + build**

Run: `npm -w web run typecheck && npm -w web run build`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/console/ParamsTab.tsx
git commit -m "feat(console): 运行参数标签(chat/engine/diagnose 数值字段 + 导演按模式,分段保存)"
```

---

## Task 7: 记忆标签

**Files:**
- Modify: `web/src/pages/console/MemoryTab.tsx`(替换占位)

- [ ] **Step 1: 写完整组件**

`web/src/pages/console/MemoryTab.tsx`:
```tsx
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
  const del = async () => { if (confirm('删除这条记忆?')) { await deleteMemory(r.id); onChanged() } }
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
```

- [ ] **Step 2: typecheck + build**

Run: `npm -w web run typecheck && npm -w web run build`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/console/MemoryTab.tsx
git commit -m "feat(console): 记忆标签(按角色/类型筛选 + 行内改重要度/内容 + 删除,作废条划线)"
```

---

## Task 8: 对局与消息标签

**Files:**
- Modify: `web/src/pages/console/GamesTab.tsx`(替换占位)

- [ ] **Step 1: 写完整组件**

`web/src/pages/console/GamesTab.tsx`:
```tsx
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
    if (!confirm(`删除对局 #${id} 及其全部走法/消息?`)) return
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
```

- [ ] **Step 2: typecheck + build**

Run: `npm -w web run typecheck && npm -w web run build`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/pages/console/GamesTab.tsx
git commit -m "feat(console): 对局与消息标签(列表 + 详情查看 moves/messages + 级联删除带确认)"
```

---

## Task 9: 路由 + 导航接线

**Files:**
- Modify: `web/src/main.tsx`

- [ ] **Step 1: 接线**

`web/src/main.tsx`:
1. import:加 `import { ConsolePage } from './pages/console/ConsolePage.js'`(与其他 page import 放一起)。
2. Route 联合(现有 `type Route = ...`)末尾加成员:`| { page: 'console' }`。
3. `useHashRoute()` 内,在 `if (hash === '#/growth')` 之前或之后加:
```ts
  if (hash === '#/console') return { page: 'console' }
```
4. App 组件的 page 选择 switch/if 链里加分支(与现有 `route.page === 'growth'` 同级):
```tsx
  else if (route.page === 'console') { page = <ConsolePage /> }
```
   (按现有写法适配:若现有用三元/对象映射而非 if-else,则照其形式加 `console` 分支。)
5. `Nav()` 里,在 `成长` 链接后加分隔与入口(照现有 `<a>`/`<span>|</span>` 形式):
```tsx
      <span style={{ color: '#555' }}>|</span>
      <a href="#/console" style={LINK_STYLE}>控制台</a>
```

- [ ] **Step 2: typecheck + build**

Run: `npm -w web run typecheck && npm -w web run build`
Expected: 无错误。

- [ ] **Step 3: Commit**

```bash
git add web/src/main.tsx
git commit -m "feat(console): #/console 路由 + 顶部导航入口"
```

---

## Task 10: 全量验证 + 收尾

- [ ] **Step 1: web 全量**

Run: `npm -w web test`
Expected: 全绿。基线 18 + 本计划新增 `admin`(7)、`console-data`(3)= 28。
Run: `npm -w web run typecheck && npm -w web run build`
Expected: 均无错误。

- [ ] **Step 2: server 未受影响**

Run: `npm -w server test`
Expected: 277 仍全绿(本计划纯前端,不应触碰后端)。

- [ ] **Step 3: 端到端人工目检(关键——组件无单测,靠此兜底)**

启动:`npm -w server run dev`(连带 Surreal)+ `npm -w web run dev`,浏览器开 `http://localhost:3420/#/console`。逐标签验证:
- **角色**:改"林教练"音色为 Cherry → 保存 → 提示"已保存";刷新页面仍是 Cherry;点"恢复默认"→ 回到 Serena。
- **密钥与模型**:输入框 placeholder 显示脱敏 key;点"显示当前"出现完整 key;改 model 保存 → 提示成功(下一次聊天用新模型,热重载)。
- **运行参数**:改 chat.speakThreshold=0.8 保存;改 diagnose.depth;导演两模式分别保存。数值超范围时后端钳制(保存后刷新看回填的钳制值)。
- **记忆**:选角色筛选;改一条 fact 的内容/重要度 → 存;删一条(确认框)。(需库里有记忆;可先走一局触发反思产出。)
- **对局与消息**:列出对局;"查看"展开 moves/messages;"删"带确认且级联(删后列表与详情消失)。
Expected: 全部即时生效、无报错(CORS 已开,跨 3420→3410 正常)。

- [ ] **Step 4: 收尾说明**

无新增提交(若 Step 3 暴露 bug,修复后单独 commit 并说明)。

---

## Self-Review 记录

- **Spec §6 覆盖**:① `#/console` 路由 + main.tsx 导航入口→Task 9;② ConsolePage 5 子标签(角色/密钥与模型/运行参数/记忆/对局与消息)→Task 3 壳 + Task 4–8 各标签;③ 复用 PageShell 暗色风/ErrorBanner→全组件 import;④ `web/src/api/admin.ts`→Task 1;⑤ 表单保存→PUT→成功/失败提示→各 Tab 的 msg 状态;⑥ key 默认脱敏 + "显示"切换(调 reveal)→Task 4;⑦ 数值参数带范围与说明→Task 2 PARAM_FIELDS + Task 6;⑧ 角色音色下拉(已验证音色)→Task 2 VOICES + Task 5。即时生效:保存即 PUT,后端即时(已在后端子项目验证)。
- **Spec §5 admin 路由对接**:getConfig/reveal/putSection、personas put/reset、memory list/update/delete、games list/get/delete —— Task 1 全覆盖,URL 与后端逐一核对(含 memory id `encodeURIComponent`)。
- **测试策略对齐**(spec 测试节"前端:admin.ts 类型 + ConsolePage 走 typecheck+build;关键纯函数可加 vitest"):admin.ts(Task 1)+ console-data(Task 2)走 vitest;组件走 typecheck+build(node 环境 vitest 无法渲染,已在架构说明);末尾人工目检兜底(Task 10 Step 3)。
- **占位扫描**:Task 3 的 5 个最小占位子组件是有意的渐进式(让页壳单独编译),Task 4–8 逐一替换为完整实现——非 TODO,每个都有对应完整代码任务。无 TBD。
- **类型一致**:`admin.ts` 导出的 `ConfigPayload/PersonaConfig/MemoryRecord/GameRow/ChatCfg/DirectorCfg/EngineCfg/DiagnoseCfg/LlmCfg/TtsCfg/GameDetail/ConfigSection` 在各 Tab props 与调用处一致引用;`putSection/putPersona/resetPersona/listMemory/updateMemory/deleteMemory/listGames/getGame/deleteGame/getConfig/revealLlmKey` 函数名在定义(Task 1)与各 Tab 调用处一致;`VOICES/PARAM_FIELDS/displayMaskedKey`(Task 2)在 Task 4/5/6 引用一致;ConsolePage 传给各 Tab 的 props(personas/llm/tts/chat/director/engine/diagnose/onChanged)与 Task 4–8 占位及完整组件签名一致。
- **后端只读**:本计划不改 server/;Task 10 Step 2 验证后端 277 不破。
