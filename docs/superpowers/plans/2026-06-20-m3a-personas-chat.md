# M3a 角色与聊天(文字版)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出"AI 棋手 + 2-3 个有性格/有身世/会看走眼的观棋者,围着棋局**与回合解耦**地自然聊天(弹幕式点评+闲聊+拉踩),跨会话记得你这个人(长期记忆+反思)"的**纯文字**闭环;语音留给 M3b。

**Architecture:** 在 M1/M2 的 Node 后端里加四块自有逻辑——① `LLMProvider` 抽象(默认火山方舟/豆包,OpenAI 兼容)+ 确定性 FakeLLM;② 角色档案(配置)+ 用机制制造差异(差异化引擎读数);③ SQLite 长期记忆 + 周期性反思;④ "围观圆桌"聊天编排(刺激驱动、集中式发言选择、成本护栏)。前端加聊天区。纯逻辑(发言选择/节奏护栏/差异化引擎读数/记忆检索)走 TDD;LLM/WS/前端用 Fake + 验证式任务。

**Tech Stack:** 复用 M1/M2(Node ESM + TS + Fastify + ws + better-sqlite3 + Vitest;前端 Vite+React)。新增 `openai` npm 包(仅作 OpenAI 兼容客户端,指向火山端点)。

**已验证的火山方舟事实(2026-06-20 实测,计划据此编写,非臆造):**
- 端点:`POST {ARK_BASE_URL}/chat/completions`,`ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3`,OpenAI 兼容,HTTP 200。
- 模型:`doubao-seed-2.0-pro`(豆包,推理模型)。
- 响应:`choices[0].message.content`;推理模型另有 `choices[0].message.reasoning_content`(展示时忽略它,只用 `content`)。
- **降本关键**:请求体加 `"thinking":{"type":"disabled"}` → `reasoning_tokens=0`,一句弹幕约 83 token;不加则深度推理(~700 token)。观棋者弹幕**默认关推理**,诊断/反思**开推理**。
- key 放 `.env`(已 gitignore),**绝不**硬编码/提交/打印。

---

## 文件结构(server 新增/改动)

```
server/src/
├─ llm/
│  ├─ provider.ts            # LLMProvider 接口 + ChatMsg/LLMOpts 类型
│  ├─ volcano.ts             # 火山/豆包 provider(openai SDK,OpenAI 兼容)
│  ├─ fake.ts                # 确定性 FakeLLM(测试用,可编排回复)
│  └─ provider.test.ts       # FakeLLM 契约测试
├─ personas/
│  ├─ personas.ts            # 角色档案(配置:棋力档/背景/口吻/帮踩倾向)+ 类型
│  ├─ personas.test.ts
│  ├─ engine-view.ts         # 按棋力档把引擎评分降级/加噪(制造"看走眼")
│  └─ engine-view.test.ts
├─ chat/
│  ├─ speaker-select.ts      # 集中式 next-speaker 加权打分(纯函数 TDD)
│  ├─ speaker-select.test.ts
│  ├─ tempo.ts               # 节奏护栏:最小静默间隔 + 每分钟上限(注入时钟)
│  ├─ tempo.test.ts
│  ├─ chat-engine.ts         # 围观圆桌编排(刺激→选人→LLM→落库→推送)
│  └─ chat-engine.test.ts
├─ memory/
│  ├─ persona-memory-repo.ts # persona_memory 读写 + 检索打分(recency+importance+relevance)
│  ├─ persona-memory-repo.test.ts
│  ├─ reflection.ts          # 局末反思:抽象高层洞见(LLM)+ 写库
│  └─ reflection.test.ts
└─ (改) store/schema.sql, ws-server.ts, session/game-session.ts, types.ts

web/src/
├─ chat/ChatPanel.tsx        # 弹幕/对话区(角色头像+气泡)
└─ (改) pages/PlayPage.tsx   # 嵌入 ChatPanel + 接收 chat WS 消息
```

---

## Task 0: 依赖与环境(火山 key 放 .env)

**Files:** 改 `server/package.json`;新建 `server/.env.example`;本地 `.env`(不提交)。

- [ ] **Step 1: 装 openai SDK(仅作 OpenAI 兼容客户端)**

Run: `cd "/Users/miaoma/Downloads/围观象棋" && npm -w server i openai@^4.67.0`
Expected: 安装成功。

- [ ] **Step 2: 写 `.env.example`(占位,可提交)**

Create `server/.env.example`:
```
# 火山方舟(豆包)— OpenAI 兼容
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
ARK_API_KEY=请填入你的火山 key(勿提交)
ARK_MODEL=doubao-seed-2.0-pro
# M1 引擎
PIKAFISH_PATH=./engine/pikafish
```

- [ ] **Step 3: 写本地 `.env`(含真实 key,不提交)**

把用户提供的真实值写入 `server/.env`(以及根 `.env` 若 dev 脚本从根读取)。确认 `.gitignore` 含 `.env`(M1 已加)。运行 `cd "/Users/miaoma/Downloads/围观象棋" && git check-ignore server/.env` 预期输出该路径(已被忽略)。**绝不把真实 key 写进任何会提交的文件或本计划。**

- [ ] **Step 4: 让 dev/test 能读 .env**

`vitest` 测试不依赖真实 key(用 FakeLLM)。运行时(ws-server)读 `process.env`;在 `server/package.json` 的 `dev` 脚本加载 .env:把 `"dev": "tsx watch src/index.ts"` 改为 `"dev": "node --env-file=.env --import tsx src/index.ts"`(Node 20+ 支持 `--env-file`)。
Run: `npm -w server run dev` 启动时不再因缺 key 报错(若引擎缺失另说)。

- [ ] **Step 5: Commit**
```bash
git add server/package.json server/.env.example package-lock.json
git commit -m "chore(m3a): add openai client dep + ark env scaffolding (.env gitignored)"
```

---

## Task 1: LLMProvider 接口 + 类型

**Files:** Create `server/src/llm/provider.ts`;改 `server/src/types.ts`(加角色/聊天类型)。

- [ ] **Step 1: 写接口与类型(无逻辑)**

Create `server/src/llm/provider.ts`:
```ts
export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

export interface LLMOpts {
  /** 关推理(高频弹幕用,省 token);诊断/反思置 false 开推理 */
  disableThinking?: boolean
  maxTokens?: number
  temperature?: number
}

export interface LLMProvider {
  /** 返回纯文本回复(只取 content,忽略 reasoning_content) */
  chat(messages: ChatMsg[], opts?: LLMOpts): Promise<string>
}
```

- [ ] **Step 2: 在 `server/src/types.ts` 追加 M3a 类型**

Append to `server/src/types.ts`:
```ts
/** 角色 id(可配置;首版预置) */
export type PersonaId = 'player' | 'laopaoer' | 'coach' | 'netizen'

/** 棋力档:决定能看到多深的引擎读数(制造"看走眼") */
export type SkillTier = 'strong' | 'medium' | 'weak'

/** 角色档案 */
export interface Persona {
  id: PersonaId
  name: string
  isPlayer: boolean        // true=AI 棋手,false=观棋者
  skill: SkillTier
  background: string       // 职业/人生经历(喂给 LLM)
  voice: string            // 口吻脾气/口头禅
  leaning: string          // 帮踩倾向(自然语言,非死规则)
}

/** 聊天一条消息(落库 + 推前端) */
export interface ChatLine {
  gameId: number
  personaId: PersonaId
  text: string
  addressee: 'human' | PersonaId | 'all'  // 说给谁
  ts: string
}

/** 触发聊天的刺激 */
export type StimulusKind =
  | 'move' | 'blunder' | 'brilliant' | 'long_think'
  | 'lose_streak' | 'idle' | 'human_said' | 'topic_open'

export interface Stimulus {
  kind: StimulusKind
  gameId: number
  /** 当前局面引擎评分(走子方视角,厘兵);无则 null */
  scoreCp: number | null
  /** 人类刚说的话(kind=human_said 时) */
  humanText?: string
  /** 张力 0..1:越高越该有人说话 */
  tension: number
}
```

- [ ] **Step 3: typecheck + commit**
```bash
npx tsc --noEmit -p server/tsconfig.json
git add server/src/llm/provider.ts server/src/types.ts
git commit -m "feat(m3a): LLMProvider interface + persona/chat types"
```

---

## Task 2: FakeLLM(确定性,测试用)+ 契约测试

**Files:** Create `server/src/llm/fake.ts`, `server/src/llm/provider.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/llm/provider.test.ts`:
```ts
import { test, expect } from 'vitest'
import { FakeLLM } from './fake.js'

test('FakeLLM 按队列依次返回,并记录收到的消息', async () => {
  const llm = new FakeLLM(['第一句', '第二句'])
  expect(await llm.chat([{ role: 'user', content: 'a' }])).toBe('第一句')
  expect(await llm.chat([{ role: 'user', content: 'b' }])).toBe('第二句')
  expect(llm.calls).toHaveLength(2)
  expect(llm.calls[1].messages[0].content).toBe('b')
})

test('FakeLLM 队列耗尽后返回默认串', async () => {
  const llm = new FakeLLM([], '兜底')
  expect(await llm.chat([{ role: 'user', content: 'x' }])).toBe('兜底')
})

test('FakeLLM 可用函数生成回复(基于输入)', async () => {
  const llm = new FakeLLM((msgs) => 'echo:' + msgs[msgs.length - 1].content)
  expect(await llm.chat([{ role: 'user', content: 'hi' }])).toBe('echo:hi')
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- provider`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现 FakeLLM**

Create `server/src/llm/fake.ts`:
```ts
import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'

type Responder = string[] | ((messages: ChatMsg[], opts?: LLMOpts) => string)

export class FakeLLM implements LLMProvider {
  calls: { messages: ChatMsg[]; opts?: LLMOpts }[] = []
  private queue: string[] | null
  private fn: ((m: ChatMsg[], o?: LLMOpts) => string) | null
  constructor(private responder: Responder = [], private fallback = '') {
    this.queue = Array.isArray(responder) ? [...responder] : null
    this.fn = typeof responder === 'function' ? responder : null
  }
  async chat(messages: ChatMsg[], opts?: LLMOpts): Promise<string> {
    this.calls.push({ messages, opts })
    if (this.fn) return this.fn(messages, opts)
    if (this.queue && this.queue.length > 0) return this.queue.shift()!
    return this.fallback
  }
}
```

- [ ] **Step 4: 运行确认通过 + commit**
```bash
npm -w server run test -- provider
git add server/src/llm/fake.ts server/src/llm/provider.test.ts
git commit -m "feat(m3a): deterministic FakeLLM + contract tests"
```

---

## Task 3: 火山/豆包 Provider(OpenAI 兼容,薄封装)

**Files:** Create `server/src/llm/volcano.ts`(薄封装,不单测——靠 Task 12 真实冒烟)

> 已实测:OpenAI 兼容,`thinking:{type:"disabled"}` 关推理,只取 `message.content`。`thinking` 不是 OpenAI 标准字段,经 `openai` SDK 的 `body`/额外参数透传。

- [ ] **Step 1: 实现**

Create `server/src/llm/volcano.ts`:
```ts
import OpenAI from 'openai'
import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'

export class VolcanoLLM implements LLMProvider {
  private client: OpenAI
  constructor(
    private model = process.env.ARK_MODEL ?? 'doubao-seed-2.0-pro',
    apiKey = process.env.ARK_API_KEY,
    baseURL = process.env.ARK_BASE_URL,
  ) {
    if (!apiKey || !baseURL) throw new Error('缺少 ARK_API_KEY / ARK_BASE_URL(见 .env)')
    this.client = new OpenAI({ apiKey, baseURL })
  }

  async chat(messages: ChatMsg[], opts: LLMOpts = {}): Promise<string> {
    // thinking 是火山扩展字段,经 OpenAI SDK 透传(类型用 as any 容纳非标准键)
    const body: any = {
      model: this.model,
      messages,
      max_tokens: opts.maxTokens ?? 200,
    }
    if (opts.temperature != null) body.temperature = opts.temperature
    if (opts.disableThinking) body.thinking = { type: 'disabled' }
    const resp: any = await this.client.chat.completions.create(body)
    return resp.choices?.[0]?.message?.content ?? ''
  }
}
```

- [ ] **Step 2: typecheck + commit**
```bash
npx tsc --noEmit -p server/tsconfig.json
git add server/src/llm/volcano.ts
git commit -m "feat(m3a): Volcano/Doubao provider via OpenAI-compatible client"
```

---

## Task 4: 角色档案(首版预置)

**Files:** Create `server/src/personas/personas.ts`, `server/src/personas/personas.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/personas/personas.test.ts`:
```ts
import { test, expect } from 'vitest'
import { PERSONAS, spectators, getPersona } from './personas.js'

test('预置 1 棋手 + 3 观棋者,各有不同棋力档', () => {
  expect(PERSONAS).toHaveLength(4)
  expect(PERSONAS.filter(p => p.isPlayer)).toHaveLength(1)
  expect(spectators()).toHaveLength(3)
  const tiers = new Set(spectators().map(p => p.skill))
  expect(tiers.size).toBeGreaterThanOrEqual(2) // 棋力档有区分
})

test('getPersona 按 id 取回,缺失抛错', () => {
  expect(getPersona('coach').name).toBeTruthy()
  expect(() => getPersona('nope' as any)).toThrow()
})

test('每个角色档案字段完整', () => {
  for (const p of PERSONAS) {
    expect(p.background.length).toBeGreaterThan(4)
    expect(p.voice.length).toBeGreaterThan(2)
    expect(p.leaning.length).toBeGreaterThan(2)
  }
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- personas`
Expected: FAIL

- [ ] **Step 3: 实现(预置档案)**

Create `server/src/personas/personas.ts`:
```ts
import type { Persona, PersonaId } from '../types.js'

export const PERSONAS: Persona[] = [
  {
    id: 'player', name: '老黑', isPlayer: true, skill: 'strong',
    background: '下了四十年棋的退休钳工,棋摊上的常胜将军,嘴上不饶人心里热。',
    voice: '沉稳、偶尔得意,爱用棋谚。', leaning: '对弈对手,赢了会点到为止地夸你两句。',
  },
  {
    id: 'laopaoer', name: '炮儿爷', isPlayer: false, skill: 'strong',
    background: '工人文化宫杀了三十年棋的老炮儿,见过大世面,毒舌。',
    voice: '京片子、损中带宠、口头禅"嚯"。', leaning: '专踩你的软招,但你下出妙手会真心叫好。',
  },
  {
    id: 'coach', name: '林教练', isPlayer: false, skill: 'medium',
    background: '体校出身的青年象棋教练,温和、爱讲棋理。',
    voice: '耐心、建设性、像老师。', leaning: '偏帮你这边,给你台阶和提示。',
  },
  {
    id: 'netizen', name: '吃瓜阿强', isPlayer: false, skill: 'weak',
    background: '刚毕业的程序员棋迷,半瓶醋,爱起哄。',
    voice: '网感、夸张、爱玩梗。', leaning: '墙头草,谁优势踩谁,负责活跃气氛。',
  },
]

export function spectators(): Persona[] { return PERSONAS.filter(p => !p.isPlayer) }

export function getPersona(id: PersonaId): Persona {
  const p = PERSONAS.find(x => x.id === id)
  if (!p) throw new Error(`unknown persona: ${id}`)
  return p
}
```

- [ ] **Step 4: 运行确认通过 + commit**
```bash
npm -w server run test -- personas
git add server/src/personas/personas.ts server/src/personas/personas.test.ts
git commit -m "feat(m3a): preset persona profiles (1 player + 3 spectators)"
```

---

## Task 5: 差异化引擎读数(用机制制造"看走眼")

**Files:** Create `server/src/personas/engine-view.ts`, `server/src/personas/engine-view.test.ts`

> 深度研究警示:光靠 prompt 角色会趋同。对策——按棋力档让角色看到不同深浅/含噪的引擎评分,弱角色**真的**会误判。纯函数,注入 rng 保证可测。

- [ ] **Step 1: 写失败测试**

Create `server/src/personas/engine-view.test.ts`:
```ts
import { test, expect } from 'vitest'
import { viewScore } from './engine-view.js'

test('strong 档:读数基本等于真值', () => {
  expect(viewScore(120, 'strong', () => 0.5)).toBe(120)
})

test('weak 档:读数被加噪,偏离真值', () => {
  // rng=1 → 取噪声区间上端,明显偏离
  const v = viewScore(120, 'weak', () => 1)
  expect(v).not.toBe(120)
  expect(Math.abs(v - 120)).toBeGreaterThanOrEqual(100)
})

test('medium 档:噪声幅度介于两者之间', () => {
  const strongDev = Math.abs(viewScore(0, 'strong', () => 1))
  const medDev = Math.abs(viewScore(0, 'medium', () => 1))
  const weakDev = Math.abs(viewScore(0, 'weak', () => 1))
  expect(medDev).toBeGreaterThan(strongDev)
  expect(weakDev).toBeGreaterThan(medDev)
})

test('null 评分原样返回', () => {
  expect(viewScore(null, 'weak', () => 1)).toBeNull()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- engine-view`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `server/src/personas/engine-view.ts`:
```ts
import type { SkillTier } from '../types.js'

/** 各档最大加噪幅度(厘兵):strong≈0(看得准),weak 最大(常看走眼) */
const NOISE_CP: Record<SkillTier, number> = { strong: 0, medium: 60, weak: 200 }

/**
 * 把"真值评分"降级为某档角色"看到的评分"。
 * rng() ∈ [0,1):映射到 [-noise, +noise] 的对称偏移。
 */
export function viewScore(trueCp: number | null, tier: SkillTier, rng: () => number): number | null {
  if (trueCp === null) return null
  const noise = NOISE_CP[tier]
  if (noise === 0) return trueCp
  const offset = Math.round((rng() * 2 - 1) * noise)
  return trueCp + offset
}
```

- [ ] **Step 4: 运行确认通过 + commit**
```bash
npm -w server run test -- engine-view
git add server/src/personas/engine-view.ts server/src/personas/engine-view.test.ts
git commit -m "feat(m3a): per-skill differential engine read (anti-homogenization)"
```

---

## Task 6: 集中式发言选择器(纯函数 TDD)

**Files:** Create `server/src/chat/speaker-select.ts`, `server/src/chat/speaker-select.test.ts`

> 深度研究修正:集中式 next-speaker + 规则优先于纯 LLM 调度。加权打分:相关度(帮踩对象/局势)× 张力 − 最近发言惩罚 + 随机扰动;返回该刺激下"谁说/说不说"。

- [ ] **Step 1: 写失败测试**

Create `server/src/chat/speaker-select.test.ts`:
```ts
import { test, expect } from 'vitest'
import { pickSpeakers } from './speaker-select.js'
import { spectators } from '../personas/personas.js'
import type { Stimulus } from '../types.js'

const base: Stimulus = { kind: 'move', gameId: 1, scoreCp: 30, tension: 0.5 }

test('低张力 + 大家刚说过 → 可能无人发言(避免刷屏)', () => {
  const recent = new Map(spectators().map(p => [p.id, 0])) // 全部 0 秒前刚说
  const picks = pickSpeakers({ ...base, tension: 0.05 }, spectators(), recent, () => 0.0)
  expect(picks.length).toBeLessThanOrEqual(1)
})

test('高张力(妙手/漏着)→ 至少一人发言', () => {
  const recent = new Map<string, number>() // 都没说过
  const picks = pickSpeakers({ ...base, kind: 'blunder', tension: 0.95 }, spectators(), recent, () => 0.9)
  expect(picks.length).toBeGreaterThanOrEqual(1)
})

test('最近刚发言的人被惩罚,不容易连续刷屏', () => {
  const recent = new Map<string, number>([['netizen', 0]]) // 阿强刚说过
  const picks = pickSpeakers({ ...base, tension: 0.9 }, spectators(), recent, () => 0.5)
  // 阿强即便分高也因惩罚靠后;不应是唯一且必然
  expect(picks).not.toEqual(['netizen'])
})

test('一次最多 2 人发言(不全员刷屏)', () => {
  const recent = new Map<string, number>()
  const picks = pickSpeakers({ ...base, tension: 1 }, spectators(), recent, () => 0.99)
  expect(picks.length).toBeLessThanOrEqual(2)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- speaker-select`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `server/src/chat/speaker-select.ts`:
```ts
import type { Persona, Stimulus, PersonaId } from '../types.js'

const RECENT_PENALTY_WINDOW_S = 30  // 30 秒内说过则按比例扣分
const SPEAK_THRESHOLD = 0.45        // 综合分超过此值才发言
const MAX_SPEAKERS = 2

/**
 * 返回本次刺激下应发言的角色 id(0..MAX_SPEAKERS 个,可能为空)。
 * recentMap: personaId -> 距上次发言秒数(越小越该被惩罚);缺失=很久没说。
 * rng: 注入随机扰动,测试可固定。
 */
export function pickSpeakers(
  stim: Stimulus, candidates: Persona[],
  recentMap: Map<string, number>, rng: () => number,
): PersonaId[] {
  const scored = candidates.map(p => {
    const base = stim.tension                              // 张力越高越想说
    const jitter = (rng() - 0.5) * 0.3                     // 个体差异/随机
    const sinceLast = recentMap.get(p.id)
    const penalty = sinceLast != null && sinceLast < RECENT_PENALTY_WINDOW_S
      ? (1 - sinceLast / RECENT_PENALTY_WINDOW_S) * 0.5
      : 0
    return { id: p.id as PersonaId, score: base + jitter - penalty }
  })
  return scored
    .filter(s => s.score >= SPEAK_THRESHOLD)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SPEAKERS)
    .map(s => s.id)
}
```

- [ ] **Step 4: 运行确认通过 + commit**
```bash
npm -w server run test -- speaker-select
git add server/src/chat/speaker-select.ts server/src/chat/speaker-select.test.ts
git commit -m "feat(m3a): centralized next-speaker selector (rules-first, anti-spam)"
```

---

## Task 7: 节奏护栏(成本/防刷屏,注入时钟)

**Files:** Create `server/src/chat/tempo.ts`, `server/src/chat/tempo.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/chat/tempo.test.ts`:
```ts
import { test, expect } from 'vitest'
import { TempoGuard } from './tempo.js'

test('最小静默间隔内拒绝再次发言', () => {
  let now = 1000
  const g = new TempoGuard({ minSilenceMs: 2000, maxPerMin: 100, now: () => now })
  expect(g.allow()).toBe(true); g.record()
  now = 2500 // 距上次 1.5s < 2s
  expect(g.allow()).toBe(false)
  now = 3100 // 距上次 2.1s ≥ 2s
  expect(g.allow()).toBe(true)
})

test('每分钟发言上限', () => {
  let now = 0
  const g = new TempoGuard({ minSilenceMs: 0, maxPerMin: 3, now: () => now })
  for (let i = 0; i < 3; i++) { expect(g.allow()).toBe(true); g.record(); now += 1000 }
  expect(g.allow()).toBe(false)        // 第 4 次,1 分钟内超限
  now += 61_000
  expect(g.allow()).toBe(true)         // 过了 1 分钟窗口
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- tempo`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `server/src/chat/tempo.ts`:
```ts
export interface TempoOpts { minSilenceMs: number; maxPerMin: number; now: () => number }

export class TempoGuard {
  private lastAt = -Infinity
  private window: number[] = []  // 最近发言时间戳
  constructor(private opts: TempoOpts) {}

  allow(): boolean {
    const t = this.opts.now()
    if (t - this.lastAt < this.opts.minSilenceMs) return false
    this.window = this.window.filter(ts => t - ts < 60_000)
    return this.window.length < this.opts.maxPerMin
  }

  record(): void {
    const t = this.opts.now()
    this.lastAt = t
    this.window.push(t)
  }
}
```

- [ ] **Step 4: 运行确认通过 + commit**
```bash
npm -w server run test -- tempo
git add server/src/chat/tempo.ts server/src/chat/tempo.test.ts
git commit -m "feat(m3a): chat tempo guard (min-silence + per-minute cap)"
```

---

## Task 8: persona_memory 表 + 仓库(检索打分)

**Files:** 改 `server/src/store/schema.sql`;Create `server/src/memory/persona-memory-repo.ts`, `server/src/memory/persona-memory-repo.test.ts`

- [ ] **Step 1: schema 追加**

Append to `server/src/store/schema.sql`:
```sql
-- 角色长期记忆(跨会话):episode=互动片段, fact=抽取的事实, insight=反思洞见
CREATE TABLE IF NOT EXISTS persona_memory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  persona_id TEXT NOT NULL,
  kind TEXT NOT NULL,                 -- episode | fact | insight
  content TEXT NOT NULL,
  game_id INTEGER,                    -- 关联对局(可空)
  importance INTEGER NOT NULL DEFAULT 1,  -- 1..5
  created_at TEXT NOT NULL,
  heat REAL NOT NULL DEFAULT 1.0      -- 衰减热度(检索用)
);
CREATE INDEX IF NOT EXISTS idx_pmem_persona ON persona_memory(persona_id, created_at);
```

- [ ] **Step 2: 写失败测试**

Create `server/src/memory/persona-memory-repo.test.ts`:
```ts
import { test, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { PersonaMemoryRepo } from './persona-memory-repo.js'

function repo() { return new PersonaMemoryRepo(openDb(':memory:')) }

test('add + 按角色取回', () => {
  const r = repo()
  r.add({ personaId: 'coach', kind: 'fact', content: '你爱走中炮', importance: 3, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  const all = r.byPersona('coach')
  expect(all).toHaveLength(1)
  expect(all[0].content).toBe('你爱走中炮')
})

test('检索按 recency+importance+relevance 排序,关键词命中加权', () => {
  const r = repo()
  r.add({ personaId: 'coach', kind: 'fact', content: '残局总是急躁', importance: 5, gameId: 1, createdAt: '2026-06-01T00:00:00Z' })
  r.add({ personaId: 'coach', kind: 'fact', content: '喜欢喝茶', importance: 1, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  // 查询含"残局"关键词 → 第一条相关度高,应排前
  const top = r.retrieve('coach', '残局怎么走', 1, () => new Date('2026-06-20T00:00:00Z').getTime())
  expect(top[0].content).toBe('残局总是急躁')
})

test('retrieve 限制条数', () => {
  const r = repo()
  for (let i = 0; i < 5; i++) r.add({ personaId: 'coach', kind: 'fact', content: 'c' + i, importance: 1, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  expect(r.retrieve('coach', 'x', 2, () => Date.parse('2026-06-20T00:00:00Z'))).toHaveLength(2)
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npm -w server run test -- persona-memory`
Expected: FAIL

- [ ] **Step 4: 实现**

Create `server/src/memory/persona-memory-repo.ts`:
```ts
import type { DB } from '../store/db.js'
import type { PersonaId } from '../types.js'

export interface MemoryRow {
  id: number; personaId: PersonaId; kind: 'episode' | 'fact' | 'insight'
  content: string; gameId: number | null; importance: number; createdAt: string; heat: number
}

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14 // 14 天半衰期

export class PersonaMemoryRepo {
  constructor(private db: DB) {}

  add(m: { personaId: PersonaId; kind: 'episode' | 'fact' | 'insight'; content: string; importance: number; gameId: number | null; createdAt: string }): number {
    const info = this.db.prepare(
      'INSERT INTO persona_memory (persona_id, kind, content, game_id, importance, created_at) VALUES (?,?,?,?,?,?)'
    ).run(m.personaId, m.kind, m.content, m.gameId, m.importance, m.createdAt)
    return Number(info.lastInsertRowid)
  }

  byPersona(personaId: PersonaId): MemoryRow[] {
    return this.rows('SELECT * FROM persona_memory WHERE persona_id=? ORDER BY created_at DESC', [personaId])
  }

  /** 检索注入用:score = recency(指数衰减) + importance/5 + relevance(关键词重合) */
  retrieve(personaId: PersonaId, query: string, limit: number, now: () => number): MemoryRow[] {
    const rows = this.byPersona(personaId)
    const qTokens = tokens(query)
    const t = now()
    const scored = rows.map(r => {
      const ageMs = t - Date.parse(r.createdAt)
      const recency = Math.pow(0.5, ageMs / RECENCY_HALFLIFE_MS)
      const importance = r.importance / 5
      const relevance = overlap(tokens(r.content), qTokens)
      return { r, score: recency + importance + relevance }
    })
    return scored.sort((a, b) => b.score - a.score).slice(0, limit).map(s => s.r)
  }

  private rows(sql: string, args: any[]): MemoryRow[] {
    const rs: any[] = this.db.prepare(sql).all(...args)
    return rs.map(r => ({ id: r.id, personaId: r.persona_id, kind: r.kind, content: r.content,
      gameId: r.game_id, importance: r.importance, createdAt: r.created_at, heat: r.heat }))
  }
}

function tokens(s: string): Set<string> {
  // 中文按字 + 英文按词,够用的最小相关度信号
  return new Set(s.toLowerCase().match(/[一-龥]|[a-z0-9]+/g) ?? [])
}
function overlap(a: Set<string>, b: Set<string>): number {
  if (b.size === 0) return 0
  let n = 0; for (const x of b) if (a.has(x)) n++
  return n / b.size
}
```

- [ ] **Step 5: 运行确认通过 + commit**
```bash
npm -w server run test -- persona-memory
git add server/src/store/schema.sql server/src/memory/persona-memory-repo.ts server/src/memory/persona-memory-repo.test.ts
git commit -m "feat(m3a): persona_memory table + retrieval (recency+importance+relevance)"
```

---

## Task 9: 反思层(局末抽象高层洞见)

**Files:** Create `server/src/memory/reflection.ts`, `server/src/memory/reflection.test.ts`

> 深度研究第一缺口:加周期性反思,把零散事实抽象成高层洞见写回。用注入的 LLMProvider,测试用 FakeLLM。

- [ ] **Step 1: 写失败测试**

Create `server/src/memory/reflection.test.ts`:
```ts
import { test, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { PersonaMemoryRepo } from './persona-memory-repo.js'
import { FakeLLM } from '../llm/fake.js'
import { reflect } from './reflection.js'

test('反思:把若干 episode/fact 交给 LLM,产出 insight 写库', async () => {
  const repo = new PersonaMemoryRepo(openDb(':memory:'))
  repo.add({ personaId: 'coach', kind: 'fact', content: '残局丢相', importance: 3, gameId: 1, createdAt: '2026-06-20T00:00:00Z' })
  repo.add({ personaId: 'coach', kind: 'fact', content: '残局又急了', importance: 3, gameId: 2, createdAt: '2026-06-20T01:00:00Z' })
  const llm = new FakeLLM(['这玩家逢残局必急躁,缺耐心'])
  await reflect({ repo, llm, personaId: 'coach', gameId: 2, now: () => Date.parse('2026-06-20T02:00:00Z') })
  const insights = repo.byPersona('coach').filter(m => m.kind === 'insight')
  expect(insights).toHaveLength(1)
  expect(insights[0].content).toMatch(/急躁/)
  expect(insights[0].importance).toBeGreaterThanOrEqual(4) // 洞见高权重
})

test('无记忆可反思时不调用 LLM、不写库', async () => {
  const repo = new PersonaMemoryRepo(openDb(':memory:'))
  const llm = new FakeLLM(['不该被调用'])
  await reflect({ repo, llm, personaId: 'coach', gameId: 1, now: () => 0 })
  expect(llm.calls).toHaveLength(0)
  expect(repo.byPersona('coach')).toHaveLength(0)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- reflection`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `server/src/memory/reflection.ts`:
```ts
import type { PersonaMemoryRepo } from './persona-memory-repo.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId } from '../types.js'
import { getPersona } from '../personas/personas.js'

export async function reflect(args: {
  repo: PersonaMemoryRepo; llm: LLMProvider; personaId: PersonaId; gameId: number; now: () => number
}): Promise<void> {
  const { repo, llm, personaId, now } = args
  const recent = repo.byPersona(personaId).filter(m => m.kind !== 'insight').slice(0, 20)
  if (recent.length === 0) return
  const persona = getPersona(personaId)
  const bullets = recent.map(m => '- ' + m.content).join('\n')
  const insight = (await llm.chat([
    { role: 'system', content: `你是${persona.name}。把对该玩家的零散观察,抽象成一条更高层、可复用的洞见(一句话,中文)。` },
    { role: 'user', content: `观察:\n${bullets}\n\n请给出一条洞见:` },
  ], { disableThinking: false, maxTokens: 120 })).trim()
  if (!insight) return
  repo.add({ personaId, kind: 'insight', content: insight, importance: 4, gameId: args.gameId,
    createdAt: new Date(now()).toISOString() })
}
```

- [ ] **Step 4: 运行确认通过 + commit**
```bash
npm -w server run test -- reflection
git add server/src/memory/reflection.ts server/src/memory/reflection.test.ts
git commit -m "feat(m3a): reflection layer (abstract scattered memories into insights)"
```

---

## Task 10: 围观圆桌编排(chat-engine,集成 TDD)

**Files:** Create `server/src/chat/chat-engine.ts`, `server/src/chat/chat-engine.test.ts`

> 把前面零件串起来:收到刺激 → 节奏护栏放行? → 选发言人 → 为每人(看到差异化引擎读数 + 检索记忆)请求 LLM(弹幕关推理)→ 产出 ChatLine 推送 + 落库 + 记 episode。注入所有依赖,确定性可测。

- [ ] **Step 1: 写失败测试**

Create `server/src/chat/chat-engine.test.ts`:
```ts
import { test, expect } from 'vitest'
import { openDb } from '../store/db.js'
import { PersonaMemoryRepo } from '../memory/persona-memory-repo.js'
import { FakeLLM } from '../llm/fake.js'
import { ChatEngine } from './chat-engine.js'
import type { Stimulus } from '../types.js'

function setup(llm: FakeLLM, now = () => 1000) {
  const mem = new PersonaMemoryRepo(openDb(':memory:'))
  const out: any[] = []
  const engine = new ChatEngine({
    llm, mem, now,
    emit: (line) => out.push(line),
    rng: () => 0.9,
    tempo: { minSilenceMs: 0, maxPerMin: 100 },
  })
  return { engine, out, mem }
}

test('高张力刺激 → 产出至少一条弹幕,落 episode 记忆,关推理', async () => {
  const llm = new FakeLLM(() => '嚯,这步软了')
  const { engine, out, mem } = setup(llm)
  const stim: Stimulus = { kind: 'blunder', gameId: 1, scoreCp: -300, tension: 0.95 }
  await engine.onStimulus(stim)
  expect(out.length).toBeGreaterThanOrEqual(1)
  expect(out[0].text).toContain('软')
  // 弹幕请求关推理(省 token)
  expect(llm.calls[0].opts?.disableThinking).toBe(true)
  // 发言被记成 episode
  expect(mem.byPersona(out[0].personaId).some(m => m.kind === 'episode')).toBe(true)
})

test('节奏护栏:静默期内的刺激不产出', async () => {
  let now = 0
  const llm = new FakeLLM(() => 'x')
  const mem = new PersonaMemoryRepo(openDb(':memory:'))
  const out: any[] = []
  const engine = new ChatEngine({ llm, mem, now: () => now, emit: (l) => out.push(l), rng: () => 0.9, tempo: { minSilenceMs: 5000, maxPerMin: 100 } })
  await engine.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, tension: 0.95 })
  const after = out.length
  now = 1000 // 1s 后,< 5s 静默
  await engine.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, tension: 0.95 })
  expect(out.length).toBe(after) // 未新增
})

test('低张力冷场 → 可能无人发言(out 可为空,不报错)', async () => {
  const llm = new FakeLLM(() => 'x')
  const { engine, out } = setup(llm, () => 1000)
  await engine.onStimulus({ kind: 'idle', gameId: 1, scoreCp: 0, tension: 0.0 })
  expect(Array.isArray(out)).toBe(true)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- chat-engine`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `server/src/chat/chat-engine.ts`:
```ts
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaMemoryRepo } from '../memory/persona-memory-repo.js'
import type { ChatLine, Stimulus, Persona, PersonaId } from '../types.js'
import { spectators, getPersona } from '../personas/personas.js'
import { viewScore } from '../personas/engine-view.js'
import { pickSpeakers } from './speaker-select.js'
import { TempoGuard } from './tempo.js'

export interface ChatEngineDeps {
  llm: LLMProvider
  mem: PersonaMemoryRepo
  now: () => number
  emit: (line: ChatLine) => void
  rng: () => number
  tempo: { minSilenceMs: number; maxPerMin: number }
}

export class ChatEngine {
  private guard: TempoGuard
  private lastSpokeAt = new Map<string, number>()  // personaId -> ms
  constructor(private deps: ChatEngineDeps) {
    this.guard = new TempoGuard({ ...deps.tempo, now: deps.now })
  }

  async onStimulus(stim: Stimulus): Promise<void> {
    if (!this.guard.allow()) return
    const recentSecs = this.recentMap()
    const speakers = pickSpeakers(stim, spectators(), recentSecs, this.deps.rng)
    if (speakers.length === 0) return
    this.guard.record()
    for (const id of speakers) {
      const persona = getPersona(id)
      const text = (await this.deps.llm.chat(this.buildPrompt(persona, stim), {
        disableThinking: true, maxTokens: 80,
      })).trim()
      if (!text) continue
      const line: ChatLine = { gameId: stim.gameId, personaId: id, text,
        addressee: this.addressee(stim), ts: new Date(this.deps.now()).toISOString() }
      this.deps.emit(line)
      this.deps.mem.add({ personaId: id, kind: 'episode', content: text, importance: 1,
        gameId: stim.gameId, createdAt: line.ts })
      this.lastSpokeAt.set(id, this.deps.now())
    }
  }

  private buildPrompt(p: Persona, stim: Stimulus) {
    const seen = viewScore(stim.scoreCp, p.skill, this.deps.rng)   // 差异化引擎读数 → 会看走眼
    const mems = this.deps.mem.retrieve(p.id as PersonaId, stim.humanText ?? stim.kind, 4, this.deps.now)
    const memText = mems.map(m => '· ' + m.content).join('\n') || '(暂无)'
    const sys = `你是「${p.name}」:${p.background} 口吻:${p.voice} 立场:${p.leaning}\n`
      + `你是观棋者,正在围观一局中国象棋。用一句话(≤25字)即兴点评/拉踩/接梗,像真人棋友,可以看走眼、有脾气。只输出这句话。\n`
      + `你对这个玩家的记忆:\n${memText}`
    const user = stim.kind === 'human_said'
      ? `玩家刚说:"${stim.humanText}"。回他一句:`
      : `刚发生:${stim.kind};你看到的局势评分(你的水平视角,可能不准):${seen ?? '看不清'}。说一句:`
    return [{ role: 'system' as const, content: sys }, { role: 'user' as const, content: user }]
  }

  private addressee(stim: Stimulus): ChatLine['addressee'] {
    return stim.kind === 'human_said' ? 'human' : 'all'
  }

  private recentMap(): Map<string, number> {
    const t = this.deps.now()
    const m = new Map<string, number>()
    for (const [id, ts] of this.lastSpokeAt) m.set(id, (t - ts) / 1000)
    return m
  }
}
```

- [ ] **Step 4: 运行确认通过(全套)+ commit**
```bash
npm -w server run test
npx tsc --noEmit -p server/tsconfig.json
git add server/src/chat/chat-engine.ts server/src/chat/chat-engine.test.ts
git commit -m "feat(m3a): round-table chat engine (stimulus -> select -> LLM -> persist)"
```

---

## Task 11: 接线 ws-server + 对局刺激钩子

**Files:** 改 `server/src/ws-server.ts`、`server/src/session/game-session.ts`

> 把落子事件转成刺激投给 ChatEngine;新增冷场定时器;聊天结果经 WS 推前端;局末触发反思。无法纯单测(依赖引擎/真实 LLM),靠 Task 12 冒烟。

- [ ] **Step 1: GameSession 暴露刺激回调**

在 `game-session.ts` 的 `GameSessionDeps` 加可选 `onStimulus?: (s: Stimulus) => void`;在 `playHumanMove` 落子后(人着/AI 着各一次)调用之,张力按丢分/胜率变化估算(用已有 `decision.chosenLine.scoreCp` 与诊断丢分;无则给中性 0.4)。保持原有返回与测试不变(回调可选,Fake 不传)。

- [ ] **Step 2: ws-server 组装 ChatEngine + 路由**

在 `buildServer` 内:`const llm = new VolcanoLLM()`、`const pmem = new PersonaMemoryRepo(db)`、`const chat = new ChatEngine({ llm, mem: pmem, now: ()=>Date.now(), emit: (line)=>broadcast(line), rng: Math.random, tempo: { minSilenceMs: 4000, maxPerMin: 12 } })`。把 `session` 的 `onStimulus` 指到 `chat.onStimulus`。`broadcast` 把 `{type:'chat', ...line}` 发给该对局的 WS 连接。新增处理 `{type:'say', gameId, text}`(玩家说话)→ 投 `human_said` 刺激。局末调用 `reflect(...)` 给每个角色。加一个 `setInterval` 冷场刺激(idle,低张力),无人时也偶尔有人闲扯。

- [ ] **Step 3: 冒烟(需引擎+key)**

设 `PIKAFISH_PATH` 与 `.env` 后 `npm run dev:server`;用 ws 客户端发 `say` 与走子,确认收到 `{type:'chat'}` 弹幕、DB `persona_memory` 出现 episode、局末出现 insight。**不要伪造**;无引擎时至少确认 `say` 路径能出弹幕(human_said 不依赖 Pikafish)。

- [ ] **Step 4: 全套测试仍绿 + commit**
```bash
npm -w server run test && npx tsc --noEmit -p server/tsconfig.json
git add server/src/ws-server.ts server/src/session/game-session.ts
git commit -m "feat(m3a): wire chat engine into ws-server + move/idle stimuli + end-game reflection"
```

---

## Task 12: 火山真实冒烟(端到端一句话)

**Files:** Create `server/scripts/smoke-llm.ts`(临时验证脚本,可保留)

- [ ] **Step 1: 写最小冒烟脚本**

Create `server/scripts/smoke-llm.ts`:
```ts
import { VolcanoLLM } from '../src/llm/volcano.js'
const llm = new VolcanoLLM()
const banter = await llm.chat(
  [{ role: 'system', content: '你是毒舌懂棋的老棋友,一句话≤25字。' },
   { role: 'user', content: '我走了当头炮,损我一句。' }],
  { disableThinking: true, maxTokens: 80 },
)
console.log('弹幕:', banter)
```

- [ ] **Step 2: 真实运行(需 .env)**

Run: `node --env-file=server/.env --import tsx server/scripts/smoke-llm.ts`
Expected: 打印一句到位的中文吐槽(实测可用)。记录真实输出。

- [ ] **Step 3: commit**
```bash
git add server/scripts/smoke-llm.ts
git commit -m "chore(m3a): volcano LLM smoke script (manual-verified)"
```

---

## Task 13: 前端聊天区

**Files:** Create `web/src/chat/ChatPanel.tsx`;改 `web/src/pages/PlayPage.tsx`、`web/src/api/ws-client.ts`

- [ ] **Step 1: ws-client 容纳 chat 消息**

在 `ServerMsg` 联合类型加 `| { type: 'chat'; personaId: string; text: string; addressee: string; ts: string }`;`PlayPage` 收到 `chat` 时 push 到一个 `lines` 状态。

- [ ] **Step 2: ChatPanel 组件**

Create `web/src/chat/ChatPanel.tsx`:`ChatPanel({ lines, onSay })` —— 渲染气泡列表(角色名+头像色块+文本,按 personaId 配色),底部一个输入框 + 发送按钮调用 `onSay(text)`(发 `{type:'say',gameId,text}`)。角色名映射:player=老黑/laopaoer=炮儿爷/coach=林教练/netizen=吃瓜阿强。

- [ ] **Step 3: 嵌入 PlayPage**

在 `PlayPage` 棋盘旁渲染 `<ChatPanel lines={lines} onSay={(t)=>conn.current?.send({type:'say',gameId,text:t})} />`。

- [ ] **Step 4: 验证**

Run: `npm -w web run typecheck && npm -w web run build`(必须真过)。条件允许时 dev 跑通"我说一句 → 观棋者回我"。
- [ ] **Step 5: commit**
```bash
git add web/
git commit -m "feat(m3a): chat panel (persona bubbles + say input) wired to ws"
```

---

## Task 14: 收尾(全量测试 + 文档)

- [ ] **Step 1: 全量**

Run: `npm -w server run test`(M1+M2+M3a 全绿)、`npm -w web run typecheck && npm -w web run build`。

- [ ] **Step 2: 更新 README**

加 M3a 段:火山方舟配置(`.env` 三个变量、关推理省 token 说明)、角色与聊天玩法、"语音见 M3b"、已知简化(见下)。

- [ ] **Step 3: commit**
```bash
git add README.md
git commit -m "docs(m3a): personas+chat readme and ark setup"
```

---

## 验收标准(M3a 完成定义)

- 浏览器里对弈时,2-3 个观棋者**与回合解耦**地自然冒泡点评/拉踩/接梗,玩家能打字跟他们对话,AI 棋手也有口吻。
- 角色**有差异**:靠差异化引擎读数(机制)+ 档案(prompt),弱角色会看走眼、各帮各踩。
- **长期记忆 + 反思**:跨会话记住该玩家,局末抽象出洞见(高权重)注入后续对话。
- **成本/防刷屏**:弹幕默认关推理(实测 ~83 token/条),最小静默间隔 + 每分钟上限生效。
- 纯逻辑(发言选择/节奏/差异化读数/记忆检索/反思写库/编排)有通过的单测;火山真实调用经冒烟验证。
- key 只在 `.env`(gitignore),无任何提交/打印泄露。

## 已知简化(ponytail,留待需要时再升级)

- 记忆相关度用"中文按字 + 英文按词"的重合度,非嵌入语义检索;个人单机数据量小够用,需要更准再上嵌入。
- 张力估算用丢分/评分变化的简单映射,非专门模型。
- 冷场闲聊用定时器 + 低张力刺激,非复杂话题模型。
- 一个豆包模型 + thinking 开关覆盖"弹幕/分析"两档,未做多模型路由。

## 留给 M3b(语音)

- `VoiceProvider` 接口 + 火山语音(STT/TTS,与 LLM 同厂,音色映射到各角色)。
- 前端采音 + 播放;`say` 改为可语音输入,`chat` 可语音播报。
- chat-engine 已产出结构化 `ChatLine`,M3b 直接在其后接 TTS,无需改编排。
