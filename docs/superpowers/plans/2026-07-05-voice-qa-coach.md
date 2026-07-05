# 语音问答闭环(默认语音 + 教练结合棋局作答)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让玩家用语音向"教练"提问,系统结合当前棋局与 Pikafish 引擎分析给出针对性回答(文字气泡 + TTS),并修复现有"语音识别失败"报错。

**Architecture:** 复用现有 ASR(百炼)、chat-engine、Pikafish、TTS 四套设施。新增 `coach_query` 刺激:玩家发言(say)时在 ws-server 层取当前局面 + 引擎分析,组装刺激传给 chat-engine,仅教练结合引擎数据作答,旁观让路。ASR 凭据与 chat 模型彻底解耦。

**Tech Stack:** Node/Fastify/TypeScript(server)、React/Vite(web)、Pikafish UCI、百炼 DashScope(ASR/TTS)、vitest。

**参考 spec:** `docs/superpowers/specs/2026-07-05-voice-qa-coach-design.md`

---

## File Structure

| 文件 | 职责 | 本计划改动 |
|---|---|---|
| `server/src/voice/dashscope-asr.ts` | 百炼 ASR provider | 新增 `dashscopeAsrCreds()` 纯函数(只读 DASHSCOPE env) |
| `server/src/ws-server.ts` | HTTP/WS 服务 | /asr 用 `dashscopeAsrCreds()`;say 处理改触发 coach_query |
| `server/src/types.ts` | 领域类型 | `StimulusKind` +coach_query −human_said;`Stimulus` +engineInsight |
| `server/src/analysis/position-insight.ts` | **新增**:当前局面引擎洞察取数 | 全新 |
| `server/src/chat/chat-engine.ts` | 弹幕/问答生成 | coach_query 仅教练作答分支;删 human_said |
| `web/src/chat/ChatPanel.tsx` | 聊天面板 | 麦克风设为默认显著入口 |
| `web/src/pages/PlayPage.tsx` | 对局页 | onSay 时 dropQueued 让路 |

**任务依赖:** Task 1(独立,修报错)→ Task 2(类型)→ Task 3(insight)→ Task 4(say 触发)→ Task 5(chat-engine)→ Task 6(前端,独立)。

---

## Task 1: 修复 ASR 凭据解耦(独立,做完报错立即好)

**根因:** `/asr` 用 `cfg.getLlm().apiKey/baseURL`(chat 模型=DeepSeek)去调百炼 `qwen3-asr-flash` → 500。ASR 是百炼专有模型,必须用独立百炼凭据(与 /tts 一致)。

**Files:**
- Modify: `server/src/voice/dashscope-asr.ts`(新增纯函数)
- Modify: `server/src/ws-server.ts:809-827`(/asr 端点)
- Test: `server/src/voice/dashscope-asr.test.ts`(新增纯函数单测)、`server/src/ws-server.test.ts:328`(改造)

- [ ] **Step 1: 写 `dashscopeAsrCreds` 纯函数的失败测试**

在 `server/src/voice/dashscope-asr.test.ts` 末尾追加(文件顶部已 `import { FakeAsr } from './asr.js'`,改为同时导入被测函数):

```ts
import { describe, it, expect, afterEach } from 'vitest'
import { FakeAsr } from './asr.js'
import { dashscopeAsrCreds } from './dashscope-asr.js'

describe('dashscopeAsrCreds(只认 DASHSCOPE env,不碰 chat 模型凭据)', () => {
  const saved = { key: process.env.DASHSCOPE_API_KEY, base: process.env.DASHSCOPE_BASE_URL }
  afterEach(() => {
    process.env.DASHSCOPE_API_KEY = saved.key
    process.env.DASHSCOPE_BASE_URL = saved.base
  })
  it('两个 env 都在 → 返回凭据', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-bailian'
    process.env.DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    expect(dashscopeAsrCreds()).toEqual({ apiKey: 'sk-bailian', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
  })
  it('缺 key → null', () => {
    delete process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    expect(dashscopeAsrCreds()).toBeNull()
  })
  it('缺 baseURL → null', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-bailian'
    delete process.env.DASHSCOPE_BASE_URL
    expect(dashscopeAsrCreds()).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/voice/dashscope-asr.test.ts`
Expected: FAIL —— `dashscopeAsrCreds is not a function` / 导入不存在。

- [ ] **Step 3: 实现 `dashscopeAsrCreds`**

在 `server/src/voice/dashscope-asr.ts` 顶部(import 之后、`export class DashscopeAsr` 之前)加:

```ts
/** ASR 凭据:只读 DASHSCOPE env,与 chat 模型(可换 DeepSeek 等)彻底解耦。
 *  ASR/TTS 都是百炼专有模型,凭据必须独立;两者缺一返回 null(端点据此 503)。 */
export function dashscopeAsrCreds(): { apiKey: string; baseURL: string } | null {
  const apiKey = process.env.DASHSCOPE_API_KEY
  const baseURL = process.env.DASHSCOPE_BASE_URL
  return apiKey && baseURL ? { apiKey, baseURL } : null
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/voice/dashscope-asr.test.ts`
Expected: PASS(含原 FakeAsr 用例 + 3 个新用例)。

- [ ] **Step 5: 改造 /asr 端点用新凭据**

`server/src/ws-server.ts` 的 `/asr` 端点(约 814-819),把:

```ts
    let asr = opts.asr
    if (!asr) {
      const llm = cfg.getLlm()
      if (!llm.apiKey || !llm.baseURL) return reply.code(503).send({ error: '未配置 DASHSCOPE,语音识别不可用' })
      asr = new DashscopeAsr(process.env.ASR_MODEL ?? 'qwen3-asr-flash', llm.apiKey, llm.baseURL)
    }
```

改为:

```ts
    let asr = opts.asr
    if (!asr) {
      const creds = dashscopeAsrCreds()
      if (!creds) return reply.code(503).send({ error: '未配置 DASHSCOPE,语音识别不可用' })
      asr = new DashscopeAsr(process.env.ASR_MODEL ?? 'qwen3-asr-flash', creds.apiKey, creds.baseURL)
    }
```

并在 `ws-server.ts` 顶部的 import 补上(第 27 行 `import { DashscopeAsr } from './voice/dashscope-asr.js'` 改为):

```ts
import { DashscopeAsr, dashscopeAsrCreds } from './voice/dashscope-asr.js'
```

- [ ] **Step 6: 加 ws-server 回归测试(证明 ASR 不再复用 chat 模型凭据)**

`server/src/ws-server.test.ts` 现有第 328 行"POST /asr 无 DASHSCOPE key 且未注入 asr → 503"用例保留(makeApp 不设 DASHSCOPE env,仍应 503)。紧随其后新增:

```ts
  it('POST /asr:chat 模型配了 key 但无 DASHSCOPE env → 仍 503(凭据不复用 chat)', async () => {
    const savedKey = process.env.DASHSCOPE_API_KEY
    delete process.env.DASHSCOPE_API_KEY
    try {
      // opts.llm 注入即"chat 模型可用",但 ASR 凭据独立:无 DASHSCOPE env 就必须 503
      app = await buildServer({ dbPath: ':memory:', engine: fakeEngine, llm: new FakeLLM(() => 'x') })
      const res = await app.inject({
        method: 'POST', url: '/asr?mime=audio/wav',
        headers: { 'content-type': 'application/octet-stream' },
        payload: Buffer.from('x'),
      })
      expect(res.statusCode).toBe(503)
    } finally {
      process.env.DASHSCOPE_API_KEY = savedKey
    }
  })
```

- [ ] **Step 7: 跑测试确认通过**

Run: `cd server && npx vitest run src/ws-server.test.ts src/voice/dashscope-asr.test.ts && npx tsc --noEmit`
Expected: 全 PASS,tsc exit 0。

- [ ] **Step 8: Commit**

```bash
git add server/src/voice/dashscope-asr.ts server/src/ws-server.ts server/src/voice/dashscope-asr.test.ts server/src/ws-server.test.ts
git commit -m "fix(voice): ASR 凭据与 chat 模型解耦,改用独立 DASHSCOPE env(修复识别失败 500)"
```

---

## Task 2: coach_query 刺激类型 + engineInsight 字段

**Files:**
- Modify: `server/src/types.ts:113-137`

- [ ] **Step 1: 改 `StimulusKind`(加 coach_query,去 human_said)**

`server/src/types.ts` 第 113-116 行:

```ts
export type StimulusKind =
  | 'move' | 'blunder' | 'brilliant' | 'long_think'
  | 'lose_streak' | 'idle' | 'human_said' | 'topic_open'
  | 'turning_point' | 'phase_shift'
```

改为(把 `human_said` 换成 `coach_query`):

```ts
export type StimulusKind =
  | 'move' | 'blunder' | 'brilliant' | 'long_think'
  | 'lose_streak' | 'idle' | 'coach_query' | 'topic_open'
  | 'turning_point' | 'phase_shift'
```

- [ ] **Step 2: 给 `Stimulus` 加 `engineInsight`,并复用 humanText 承载玩家问题**

`server/src/types.ts` 的 `Stimulus` 接口内,把注释行 `/** 人类刚说的话(kind=human_said 时) */` 改为 `/** 玩家提问文本(kind=coach_query 时) */`;并在 `byPlayerPersona?` 之后、接口结束 `}` 之前加:

```ts
  /** coach_query 时:当前局面的引擎洞察(降级时为 null) */
  engineInsight?: EngineInsight | null
```

在 `Stimulus` 接口**之前**新增类型定义:

```ts
/** 当前局面的引擎洞察(coach_query 用);评分统一为红方视角 */
export interface EngineInsight {
  evalCp: number | null      // 红方视角厘兵分(正=红优)
  bestMoveZh: string | null  // 最佳应着中文,如 "红马二进三"
  pvZh: string[]             // 后续变例中文,最多 3 手,可空
  mate: number | null        // n 步杀(正=当前走子方可杀),非杀为 null
}
```

- [ ] **Step 3: 跑类型检查(此时会暴露 human_said 的旧引用,Task 5 修)**

Run: `cd server && npx tsc --noEmit 2>&1 | grep -i "human_said\|coach_query" | head`
Expected: 报 `chat-engine.ts` 等处 `human_said` 不在 StimulusKind —— 这是预期(Task 5 清理);记下报错位置。若无其他新错即可。

- [ ] **Step 4: Commit**

```bash
git add server/src/types.ts
git commit -m "feat(types): StimulusKind 加 coach_query 去 human_said;Stimulus 加 EngineInsight"
```

---

## Task 3: 局面分析取数(position-insight.ts)

**职责:** 给引擎 + 当前 FEN,算出红方视角评分、最佳应着(中文)、变例(中文)、杀棋步数;失败/无引擎返回 null。

**Files:**
- Create: `server/src/analysis/position-insight.ts`
- Test: `server/src/analysis/position-insight.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/analysis/position-insight.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { buildPositionInsight } from './position-insight.js'
import type { EngineLine } from '../types.js'

// 红方起始局面(红先走)
const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

function fakeEngine(lines: EngineLine[]) {
  return { analyze: async () => lines }
}

describe('buildPositionInsight', () => {
  it('红方走子:evalCp 直接取 scoreCp(红方视角),bestMoveZh 由 pv[0] 推出', async () => {
    const eng = fakeEngine([{ multipv: 1, move: 'h2e2', scoreCp: 60, mate: null, pv: ['h2e2', 'h9g7'] }])
    const ins = await buildPositionInsight(eng, START, 300)
    expect(ins).not.toBeNull()
    expect(ins!.evalCp).toBe(60)                 // 红走子 → 不翻转
    expect(ins!.bestMoveZh).toBe('红炮二平五')    // h2e2 从起始局面
    expect(ins!.pvZh.length).toBeGreaterThanOrEqual(1)
    expect(ins!.pvZh[0]).toBe('红炮二平五')
  })

  it('黑方走子:evalCp 翻转为红方视角', async () => {
    // 黑先走的 FEN(仅改走子方为 b);scoreCp 是走子方(黑)视角 +100 → 红方视角应为 -100
    const blackToMove = START.replace(' w ', ' b ')
    const eng = fakeEngine([{ multipv: 1, move: 'h9g7', scoreCp: 100, mate: null, pv: ['h9g7'] }])
    const ins = await buildPositionInsight(eng, blackToMove, 300)
    expect(ins!.evalCp).toBe(-100)
  })

  it('引擎抛错 → 返回 null(降级)', async () => {
    const eng = { analyze: async () => { throw new Error('引擎未配置') } }
    expect(await buildPositionInsight(eng, START, 300)).toBeNull()
  })

  it('引擎返回空数组 → 返回 null', async () => {
    expect(await buildPositionInsight(fakeEngine([]), START, 300)).toBeNull()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/analysis/position-insight.test.ts`
Expected: FAIL —— 模块不存在。

- [ ] **Step 3: 实现 position-insight.ts**

Create `server/src/analysis/position-insight.ts`:

```ts
import type { EngineInsight, EngineLine } from '../types.js'
import { Position } from '../rules/position.js'
import { describeMoveZh } from '../rules/describe-move.js'

interface EngineLike {
  analyze(fen: string, opts: { multipv: number; movetime?: number; depth?: number }): Promise<EngineLine[]>
}

/** 沿 pv 逐手推进 FEN 并转中文,最多取 maxPlies 手;任一步解析失败即止。 */
function pvToZh(fen: string, pv: string[], maxPlies: number): string[] {
  const out: string[] = []
  let cur = fen
  for (const mv of pv.slice(0, maxPlies)) {
    try {
      out.push(describeMoveZh(cur, mv))
      cur = Position.fromFen(cur).applyMove(mv).fen()
    } catch {
      break
    }
  }
  return out
}

/**
 * 取当前局面的引擎洞察(coach_query 用)。评分统一转红方视角。
 * 引擎缺失/抛错/无候选 → 返回 null,上层降级为纯 LLM 作答。
 */
export async function buildPositionInsight(
  engine: EngineLike,
  fen: string,
  movetime: number,
): Promise<EngineInsight | null> {
  let lines: EngineLine[]
  try {
    lines = await engine.analyze(fen, { multipv: 1, movetime })
  } catch {
    return null
  }
  const top = lines[0]
  if (!top) return null

  // scoreCp 是走子方视角;黑方走子时翻转为红方视角(与 Stimulus.scoreCp 口径一致)
  const blackToMove = Position.fromFen(fen).sideToMove() === 'black'
  const evalCp = blackToMove ? -top.scoreCp : top.scoreCp
  const mate = top.mate == null ? null : (blackToMove ? -top.mate : top.mate)

  let bestMoveZh: string | null = null
  try { bestMoveZh = describeMoveZh(fen, top.move) } catch { bestMoveZh = null }

  return { evalCp, bestMoveZh, pvZh: pvToZh(fen, top.pv, 3), mate }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/analysis/position-insight.test.ts && npx tsc --noEmit 2>&1 | grep -v human_said | grep error | head`
Expected: 测试全 PASS;tsc 除 human_said 相关外无新错。

- [ ] **Step 5: Commit**

```bash
git add server/src/analysis/position-insight.ts server/src/analysis/position-insight.test.ts
git commit -m "feat(analysis): buildPositionInsight——当前局面引擎洞察(红方视角评分+中文着法+变例)"
```

---

## Task 4: 服务端 say 处理改触发 coach_query

**Files:**
- Modify: `server/src/ws-server.ts:452-477`(say 分支)
- Test: `server/src/ws-server.test.ts`(WS 流程,验证 say → coach_query)

**背景:** 现有 say 分支(452-477)落库 + 回显 + 触发 `human_said`。改为:不触发 human_said,改取 engineInsight 并触发 coach_query。`engine`(可能 null)与 `cfg` 在 buildServer 闭包内可见;`repo.getMoves(gid)` 取当前 FEN。

- [ ] **Step 1: 写 WS 流程失败测试**

参考现有 ws-server.test.ts 的 WS 测试模式(真实 listen + ws 客户端)。在文件内 WS 测试区新增(engine 用会返回固定 line 的 fake,chat 用 FakeLLM 让教练必答):

```ts
  it('玩家 say → 触发 coach_query,教练结合局面回答(addressee=human)', async () => {
    const { FakeLLM } = await import('./llm/fake.js')
    const engine = {
      analyze: async () => [{ multipv: 1, move: 'h2e2', scoreCp: 40, mate: null, pv: ['h2e2'] }],
      bestMove: async () => 'h0g2',   // 供对弈用(若 EngineLike 需要);无则删
    }
    const app = await buildServer({ dbPath: ':memory:', engine: engine as any, llm: new FakeLLM(() => '教练:这步稳,先出直车') })
    await app.listen({ port: 0 })
    const port = (app.server.address() as any).port
    const chatLines: any[] = []
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/play`)
      ws.on('open', () => ws.send(JSON.stringify({ type: 'new', mode: 'coach', humanSide: 'red' })))
      ws.on('message', (raw) => {
        const m = JSON.parse(raw.toString())
        if (m.type === 'started') ws.send(JSON.stringify({ type: 'say', gameId: m.gameId, text: '我这步该走哪?' }))
        else if (m.type === 'chat' && m.addressee === 'human' && m.personaId === 'coach') { chatLines.push(m); ws.close(); resolve() }
      })
      ws.on('error', reject)
      setTimeout(() => reject(new Error('超时:未收到教练回答')), 8000)
    })
    expect(chatLines.length).toBeGreaterThanOrEqual(1)
    await app.close()
  }, 12_000)
```

> 注:`WebSocket` 与现有 WS 测试用同一导入(文件顶部若已 `import WebSocket from 'ws'` 则复用)。engine 的额外方法按现有 `fakeEngine` 形状补齐(见文件顶部 fakeEngine 定义),多余字段用 `as any` 规避。

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/ws-server.test.ts -t coach_query`
Expected: FAIL —— 收不到 `personaId==='coach' && addressee==='human'` 的 chat(当前走 human_said,pickSpeakers 未必选 coach)。

- [ ] **Step 3: 改 say 分支触发 coach_query**

`server/src/ws-server.ts` say 分支内,把原 human_said 触发块:

```ts
          // 观众席关闭 = 观棋者闭嘴(不产生 AI 回应刺激),但玩家自己的话照常回显+落库
          const cfg2 = cfg.getChat()
          if (!spectatorsOffGames.has(gid)) {
            void chat.onStimulus({ kind: 'human_said', gameId: gid, scoreCp: null, humanText: text, tension: cfg2.humanSaidTension })
          }
```

改为:

```ts
          // 观众席关闭 = 观棋者闭嘴;开启时:玩家提问 → 取当前局面引擎洞察 → coach_query(教练结合棋局作答,旁观让路)
          const cfg2 = cfg.getChat()
          if (!spectatorsOffGames.has(gid)) {
            const movesNow = (() => { try { return repo.getMoves(gid) } catch { return [] } })()
            const game2 = repo.getGame(gid)
            const curFen = movesNow.length ? movesNow[movesNow.length - 1].fenAfter : (game2?.startFen ?? '')
            void (async () => {
              const insight = engine && curFen ? await buildPositionInsight(engine, curFen, cfg.getEngineParams().movetime) : null
              chat.onStimulus({ kind: 'coach_query', gameId: gid, scoreCp: insight?.evalCp ?? null, humanText: text, engineInsight: insight, tension: cfg2.humanSaidTension })
            })().catch(() => { /* 洞察/生成失败静默,不影响对局 */ })
          }
```

在 `ws-server.ts` 顶部 import 区新增:

```ts
import { buildPositionInsight } from './analysis/position-insight.js'
```

> `repo.getMoves` 返回项含 `fenAfter`;`repo.getGame(gid)` 取 `startFen`(空局面兜底)。若 `repo.getGame` 名称不同,用文件内已有的取 game 方式(搜索 `repo.getGame` 或 `getGame(` 确认;本仓库为 `repo.getGame`)。

- [ ] **Step 4: 跑测试确认通过**

Run: `cd server && npx vitest run src/ws-server.test.ts -t coach_query`
Expected: PASS(需 Task 5 的 chat-engine coach_query 分支已实现才能真正只选 coach —— 见下方顺序说明)。

> **执行顺序说明:** Task 4 Step 1 的测试依赖 Task 5(chat-engine 让 coach_query 只选 coach)。可先完成 Task 4 Step 3 的触发改造 + Commit(Step 5),再做 Task 5,最后回来跑 Step 4。或按 subagent-driven 一次性把 Task 4+5 视为一个交付单元。实现者请在 Task 5 完成后再断言此测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/ws-server.ts
git commit -m "feat(ws): 玩家发言改触发 coach_query(取当前局面引擎洞察),替代 human_said"
```

---

## Task 5: chat-engine coach_query 分支(仅教练作答 + 删 human_said)

**Files:**
- Modify: `server/src/chat/chat-engine.ts`(handleStimulus speakers 分流 + plan 分支 + 删 human_said 引用)
- Test: `server/src/chat/chat-engine.test.ts`

- [ ] **Step 1: 写失败测试**

`server/src/chat/chat-engine.test.ts` 新增(复用文件内 `setup`/`FakeLLM`/`makeCfg`):

```ts
test('coach_query:只教练发言(旁观让路),prompt 含问题与引擎洞察', async () => {
  const prompts: string[] = []
  const llm = new FakeLLM((msgs) => { msgs.forEach(m => prompts.push(m.content)); return '中路稳一手,先走马二进三' })
  const { engine, out } = setup(llm)  // maxSpeakers 默认 1
  await engine.onStimulus({
    kind: 'coach_query', gameId: 7, scoreCp: 40, humanText: '我这步该走哪?',
    engineInsight: { evalCp: 40, bestMoveZh: '红马二进三', pvZh: ['红马二进三', '黑炮8平5'], mate: null },
    tension: 0.9,
  } as any)
  // 只 1 人(教练)发言,且是对 human
  expect(out.length).toBe(1)
  expect(out[0].personaId).toBe('coach')
  expect(out[0].addressee).toBe('human')
  // prompt 含玩家问题 + 引擎最佳着法
  expect(prompts.some(p => p.includes('我这步该走哪?'))).toBe(true)
  expect(prompts.some(p => p.includes('红马二进三'))).toBe(true)
})

test('coach_query:engineInsight=null 时走降级(不含引擎数据,仍作答)', async () => {
  const prompts: string[] = []
  const llm = new FakeLLM((msgs) => { msgs.forEach(m => prompts.push(m.content)); return '凭手感,先稳住中路' })
  const { engine, out } = setup(llm)
  await engine.onStimulus({ kind: 'coach_query', gameId: 8, scoreCp: null, humanText: '现在谁占优?', engineInsight: null, tension: 0.9 } as any)
  expect(out.length).toBe(1)
  expect(out[0].personaId).toBe('coach')
  expect(prompts.some(p => p.includes('现在谁占优?'))).toBe(true)
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `cd server && npx vitest run src/chat/chat-engine.test.ts -t coach_query`
Expected: FAIL —— coach_query 未处理(可能选不出 coach 或 plan 无分支)。

- [ ] **Step 3: handleStimulus 里给 coach_query 固定只选教练**

`server/src/chat/chat-engine.ts` 的 `handleStimulus`,把现有 speakers 选取 + player 附和块(约 129-138):

```ts
    const chat = this.deps.cfg.getChat()
    const maxSpk = chat.maxSpeakers  // 每步发言人数(默认 1=只一个人说;控制台可调高)
    const speakers = pickSpeakers(stim, this.deps.cfg.personas().filter(p => !p.isPlayer), recentSecs, this.deps.rng, chat.speakThreshold, chat.jitterWidth, maxSpk)

    // 老黑(AI 棋手)参与:自己刚走→高概率自评;其余有看头时→中概率作为当事人插话
    if (stim.byPlayerPersona) {
      if (this.deps.rng() < chat.playerSelfProb) speakers.push('player')
    } else if (this.deps.rng() < chat.playerChimeProb && (stim.moveZh != null || stim.kind === 'human_said' || stim.kind === 'idle')) {
      speakers.push('player')
    }
```

改为:

```ts
    const chat = this.deps.cfg.getChat()
    let speakers: PersonaId[]
    if (stim.kind === 'coach_query') {
      // 旁观让路:玩家提问只让教练结合棋局作答,不选其他旁观者、不让老黑插话
      const spectators = this.deps.cfg.personas().filter(p => !p.isPlayer)
      const coach = spectators.find(p => p.id === 'coach') ?? spectators[0]
      speakers = coach ? [coach.id] : []
    } else {
      const maxSpk = chat.maxSpeakers  // 每步发言人数(默认 1=只一个人说;控制台可调高)
      speakers = pickSpeakers(stim, this.deps.cfg.personas().filter(p => !p.isPlayer), recentSecs, this.deps.rng, chat.speakThreshold, chat.jitterWidth, maxSpk)
      // 老黑(AI 棋手)参与:自己刚走→高概率自评;其余有看头时→中概率作为当事人插话
      if (stim.byPlayerPersona) {
        if (this.deps.rng() < chat.playerSelfProb) speakers.push('player')
      } else if (this.deps.rng() < chat.playerChimeProb && (stim.moveZh != null || stim.kind === 'idle')) {
        speakers.push('player')
      }
    }
```

(注:`speakers` 由 `const` 改 `let`;player 附和条件里删掉 `stim.kind === 'human_said'`。)

- [ ] **Step 4: plan() 加 coach_query 分支,删 human_said 分支**

`server/src/chat/chat-engine.ts` 的 `plan()`,把现有 human_said 分支(约 279-281):

```ts
    } else if (stim.kind === 'human_said') {
      user = `玩家刚冲你们说:"${stim.humanText}"。${len},回他一句,口语自然:`
      addressee = 'human'
    } else if (stim.kind === 'long_think') {
```

改为:

```ts
    } else if (stim.kind === 'coach_query') {
      const ei = stim.engineInsight
      const insightLine = ei
        ? `引擎判断:${qualWord(ei.evalCp)}(红方${ei.evalCp ?? '?'}分)`
          + (ei.bestMoveZh ? `,最佳应着「${ei.bestMoveZh}」` : '')
          + (ei.pvZh.length ? `,后续「${ei.pvZh.join('、')}」` : '')
          + (ei.mate != null ? `;有${Math.abs(ei.mate)}步杀` : '') + '。'
        : '(引擎暂不可用,凭你的棋力判断。)'
      user = `棋手问你:"${stim.humanText}"。${insightLine}结合眼前局面针对性回答他的问题,专业、有据、口语,别长篇,可引一句棋理:`
      addressee = 'human'
    } else if (stim.kind === 'long_think') {
```

- [ ] **Step 5: 清理 human_said 残留引用**

`server/src/chat/chat-engine.ts` 第 96 行附近注释里的 `human_said` 改为 `coach_query`(仅注释,示意"低频重要刺激不丢"):把 `human_said 等低频但重要的刺激` 改为 `coach_query 等低频但重要的刺激`。

Run 确认再无 human_said 引用:`cd server && grep -rn "human_said" src/ --include='*.ts' | grep -v '\.test\.'`
Expected: 无输出(测试文件里若还有历史 human_said 用例,一并改为 coach_query 或删除)。

- [ ] **Step 6: 跑测试 + 全量类型检查**

Run: `cd server && npx vitest run src/chat/chat-engine.test.ts && npx tsc --noEmit`
Expected: coach_query 两用例 PASS;tsc exit 0(human_said 报错消失)。

- [ ] **Step 7: 回跑 Task 4 的 WS 测试(现在应 PASS)**

Run: `cd server && npx vitest run src/ws-server.test.ts -t coach_query`
Expected: PASS(教练结合局面回答,addressee=human)。

- [ ] **Step 8: 全量 server 测试**

Run: `cd server && npx vitest run`
Expected: 全 PASS(若有其他文件残留 human_said 断言,改为 coach_query)。

- [ ] **Step 9: Commit**

```bash
git add server/src/chat/chat-engine.ts server/src/chat/chat-engine.test.ts
git commit -m "feat(chat): coach_query 仅教练结合引擎洞察作答(旁观让路),移除 human_said"
```

---

## Task 6: 前端默认语音 + 提问让路

**Files:**
- Modify: `web/src/chat/ChatPanel.tsx`(麦克风默认显著入口 + 提示语)
- Modify: `web/src/pages/PlayPage.tsx:529`(onSay 时 dropQueued 让路)

- [ ] **Step 1: PlayPage 提问时清在途旧弹幕(让路的前端部分)**

`web/src/pages/PlayPage.tsx` 第 529 行 onSay:

```tsx
              onSay={(t) => { if (status === 'playing' && gameId !== null) wsRef.current?.send({ type: 'say', gameId, text: t }) }}
```

改为(提问即清掉没播完的旧弹幕,让教练回答优先播报):

```tsx
              onSay={(t) => {
                if (status === 'playing' && gameId !== null) {
                  dropQueued()  // 让路:清掉在途旧弹幕,教练回答优先
                  wsRef.current?.send({ type: 'say', gameId, text: t })
                }
              }}
```

`dropQueued` 已在 `web/src/pages/PlayPage.tsx:8` 从 `../voice/server-tts.js` 导入,无需新增 import。

- [ ] **Step 2: ChatPanel 麦克风设为默认显著入口**

`web/src/chat/ChatPanel.tsx` 麦克风按钮(约 213-222)与输入框(约 243)所在的输入区:把麦克风按钮的默认态样式提亮(始终显眼,而非仅 listening 时),并把文字框 placeholder 从"说点什么…"改为"点麦克风说话,或打字…"以示语音优先。

麦克风按钮样式(213-222 附近)`background`/`border` 的非 listening 分支,由 `color.surfaceAlt`/`color.border` 改为强调色:

```tsx
              background: stt.listening ? color.warning : color.gold,
              border: stt.listening ? `1px solid ${color.warning}` : `1px solid ${color.gold}`,
```

placeholder(约 243)`placeholder="说点什么…"` 改为:

```tsx
          placeholder="点麦克风说话,或打字提问…"
```

> 强调色用 `web/src/ui/theme.ts` 的 `color.gold`(primary 按钮同款金色),listening 态用 `color.warning`。ChatPanel 已 import `color`。仅视觉强调,不改交互(仍点击开始/停止)。

- [ ] **Step 3: 前端类型检查 + 构建**

Run: `cd web && npx tsc --noEmit && npx vite build`
Expected: tsc exit 0;build 成功。

- [ ] **Step 4: Commit**

```bash
git add web/src/chat/ChatPanel.tsx web/src/pages/PlayPage.tsx
git commit -m "feat(web): 麦克风设为默认显著语音入口 + 提问时 dropQueued 让路"
```

---

## Task 7: 端到端联调验证(真机)

**Files:** 无(手动/脚本验证)

- [ ] **Step 1: 确保 .env 有百炼凭据**

Run: `cd server && grep -c DASHSCOPE_API_KEY .env`
Expected: ≥1(缺则按 .env.example 填百炼 key)。

- [ ] **Step 2: 重启 server(加载新代码)+ 起前端**

Run(两个终端):`cd server && npm run dev` / `cd web && npm run dev`
Expected: server 监听 3410;前端 3420。

- [ ] **Step 3: 浏览器 localhost:3420 新开一局,点麦克风问"我这步该走哪"**

Expected:
- 不再"语音识别失败";识别出文字。
- 教练气泡回答,内容结合当前局面(提到评分/着法),并 TTS 念出。
- 提问期间其他旁观弹幕让路,答完恢复。

- [ ] **Step 4: 若报错,查 server 终端日志的真实 ASR 错误**(Task 1 已让 500 记 `req.log.error`)。

---

## Self-Review(计划自审)

**1. Spec 覆盖:** ①ASR 凭据解耦=Task 1 ✓ ②局面分析取数=Task 3 ✓ ③coach_query 类型=Task 2 ✓ ④say 触发改造=Task 4 ✓ ⑤教练问答分支+旁观让路+不丢弃+不 player 插话=Task 5 ✓ ⑥前端默认语音+让路=Task 6 ✓ ⑦human_said 清理=Task 5 Step 5 ✓ ⑧错误分级/降级=Task 1(503/500)+Task 3(null 降级)+Task 4(catch) ✓ ⑨测试=各 Task 内 ✓。coach_query "不进高频丢弃窗口"由默认行为保证(未加入 HIGH_FREQ_KINDS),已在 Task 5 注释说明。

**2. 占位扫描:** 无 TBD/TODO;每个改动步骤都给了完整前后代码。前端 `color.accent` 与 engine 额外方法处标注了"以仓库实际命名为准"的核对指引(非占位,是跨文件核对提示)。

**3. 类型一致性:** `EngineInsight`(Task 2 定义)字段 evalCp/bestMoveZh/pvZh/mate 在 Task 3(产出)、Task 5(消费 `stim.engineInsight`)一致;`buildPositionInsight(engine, fen, movetime)` 签名在 Task 3 定义、Task 4 调用一致;`coach_query` kind 在 Task 2/4/5 一致;`dashscopeAsrCreds()` 在 Task 1 定义与使用一致。

**已知跨任务顺序依赖:** Task 4 的 WS 测试需 Task 5 完成后才 PASS(已在 Task 4 Step 4 与 Task 5 Step 7 标注),subagent 执行时把 Task 4+5 作为连续单元处理。
