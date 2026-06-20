# 记忆重构(SurrealDB 语义记忆)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把现有 SQLite 关键词记忆重构为 SurrealDB HNSW 语义记忆,对外暴露异步 `MemoryStore` 接口,fact/insight 写入时经 LLM 判重/作废,检索走向量 KNN;episode 保持廉价 append。

**Architecture:** 新增 `MemoryStore` 接口(`record/retrieve/list/update/remove`)与 `EmbeddingProvider` 接口。两实现:测试用 `FakeMemoryStore`(内存、append-only、recency 排序),生产用 `SurrealMemoryStore`(连本机 `surreal start` 进程,HNSW KNN + 写入时 `memory-judge` 判 merge/supersede/keep)。`chat-engine`/`reflection`/`ws-server` 三处调用点改为 async 走接口。嵌入失败时降级:照存无向量、检索退回 recency。

**Tech Stack:** TypeScript (ESM, `.js` import 后缀)、vitest、SurrealDB v3.1.5(已装 `~/.surrealdb/surreal`,独立服务进程 + SurrealKV 文件引擎)、`surrealdb` JS 客户端(WebSocket)、DashScope `text-embedding-v3`(OpenAI 兼容 `/embeddings`)、`concurrently`。

参考 spec:[2026-06-20-记忆重构-SurrealDB语义记忆-design.md](../specs/2026-06-20-记忆重构-SurrealDB语义记忆-design.md)

---

## 文件结构

**新建**
- `server/src/llm/embedding.ts` — `EmbeddingProvider` 接口 + `FakeEmbedding`
- `server/src/llm/dashscope-embedding.ts` — `DashscopeEmbedding`(调 text-embedding-v3)
- `server/src/memory/store.ts` — `MemoryRecord` 类型 + `MemoryStore` 接口
- `server/src/memory/fake-memory-store.ts` — `FakeMemoryStore`(内存测试双)
- `server/src/memory/memory-judge.ts` — `judgeMemory`(LLM 判 merge/supersede/keep + 解析)
- `server/src/memory/surreal-memory-store.ts` — `SurrealMemoryStore`(生产实现)

**修改**
- `server/package.json` — 加 `surrealdb`、`concurrently` 依赖与 dev 脚本
- `server/src/chat/chat-engine.ts` — `mem` 类型改 `MemoryStore`,`add→record`、`retrieve` 改 async,`plan()` 改 async
- `server/src/memory/reflection.ts` — `repo: PersonaMemoryRepo` → `store: MemoryStore`,`add→record` 加 await
- `server/src/ws-server.ts` — 构造 `EmbeddingProvider` + `SurrealMemoryStore`(失败降级),更新 `reflect` 调用
- 既有测试 `chat-engine.test.ts`、`reflection.test.ts` — mock 由同步 repo 改 async store

**保留不动**:`persona-memory-repo.ts`(episode 日志仍可用旧表,但本计划不再写入它;留作历史,后续可删)。

---

## Task 0: 依赖与 dev 进程接入

**Files:**
- Modify: `server/package.json`
- Modify: `package.json`(仓库根,若 dev 脚本在根则改根;否则只改 server)

- [ ] **Step 1: 安装依赖**

Run:
```bash
npm -w server install surrealdb
npm -w server install -D concurrently
```
Expected: `server/package.json` 出现 `"surrealdb"` 于 dependencies、`"concurrently"` 于 devDependencies;`server/node_modules` 生成。

- [ ] **Step 2: 加"连带启动 Surreal"的 dev 脚本**

修改 `server/package.json` 的 `scripts`,把原 `dev` 改名为 `dev:server`,新增 `dev:surreal` 与组合 `dev`:

```json
"scripts": {
  "test": "vitest run",
  "test:watch": "vitest",
  "dev": "concurrently -k -n surreal,server -c magenta,cyan \"npm:dev:surreal\" \"npm:dev:server\"",
  "dev:surreal": "$HOME/.surrealdb/surreal start surrealkv://$HOME/.surrealdb/data/weiguan.db --bind 127.0.0.1:8000 --user root --pass root",
  "dev:server": "tsx watch --env-file=.env src/index.ts",
  "build": "tsc -p tsconfig.json && cp src/store/schema.sql dist/store/schema.sql",
  "start": "node dist/index.js"
}
```

注:`-k` 让一个进程退出时连带杀掉另一个;数据落 `~/.surrealdb/data/weiguan.db`(仓库外,无需 gitignore)。

- [ ] **Step 3: 冒烟验证 Surreal 能起**

Run:
```bash
mkdir -p "$HOME/.surrealdb/data"
"$HOME/.surrealdb/surreal" start "surrealkv://$HOME/.surrealdb/data/smoke.db" --bind 127.0.0.1:8001 --user root --pass root &
sleep 2
"$HOME/.surrealdb/surreal" sql --endpoint ws://127.0.0.1:8001 --user root --pass root --ns t --db t --pretty <<< "INFO FOR DB;"
kill %1
```
Expected: 打印一个空的 DB 信息结构(tables 为空),无连接错误。若 `surrealkv://` 语法报错,改试 `rocksdb://` 或 `file://` 前缀并相应更新 Step 2(以 `surreal start --help` 的 PATH 说明为准)。

- [ ] **Step 4: Commit**

```bash
git add server/package.json server/package-lock.json package-lock.json
git commit -m "chore(memory): 引入 surrealdb + concurrently,dev 连带启动本机 Surreal 进程"
```

---

## Task 1: EmbeddingProvider 接口 + FakeEmbedding

**Files:**
- Create: `server/src/llm/embedding.ts`
- Test: `server/src/llm/embedding.test.ts`

- [ ] **Step 1: 写失败测试**

`server/src/llm/embedding.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { FakeEmbedding } from './embedding.js'

describe('FakeEmbedding', () => {
  it('返回与输入等长、且每个为定维向量', async () => {
    const emb = new FakeEmbedding(16)
    const vecs = await emb.embed(['当头炮', '把马跳'])
    expect(vecs).toHaveLength(2)
    expect(vecs[0]).toHaveLength(16)
    expect(emb.dimension).toBe(16)
  })

  it('确定性:同一文本两次嵌入完全相同', async () => {
    const emb = new FakeEmbedding(16)
    const [a] = await emb.embed(['残局易急躁'])
    const [b] = await emb.embed(['残局易急躁'])
    expect(a).toEqual(b)
  })

  it('不同文本向量不同', async () => {
    const emb = new FakeEmbedding(16)
    const [a] = await emb.embed(['爱走当头炮'])
    const [b] = await emb.embed(['偏好屏风马'])
    expect(a).not.toEqual(b)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm -w server test -- embedding`
Expected: FAIL —— 找不到模块 `./embedding.js` 或 `FakeEmbedding`。

- [ ] **Step 3: 写实现**

`server/src/llm/embedding.ts`:
```ts
export interface EmbeddingProvider {
  /** 返回与 texts 等长的向量数组,每个向量长度 = dimension */
  embed(texts: string[]): Promise<number[][]>
  readonly dimension: number
}

/** 测试用确定性嵌入:对文本做字符 hash 散布到 dimension 维,再 L2 归一化。
 *  无网络、可复现;同文本同向量、不同文本不同向量。 */
export class FakeEmbedding implements EmbeddingProvider {
  constructor(public readonly dimension = 16) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.one(t))
  }

  private one(text: string): number[] {
    const v = new Array(this.dimension).fill(0)
    for (let i = 0; i < text.length; i++) {
      const code = text.charCodeAt(i)
      v[(code + i) % this.dimension] += ((code % 17) - 8) / 8 // 落在 [-1,1) 附近
    }
    // L2 归一化(避免全 0)
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1
    return v.map((x) => x / norm)
  }
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm -w server test -- embedding`
Expected: PASS(3 个用例)。

- [ ] **Step 5: Commit**

```bash
git add server/src/llm/embedding.ts server/src/llm/embedding.test.ts
git commit -m "feat(memory): EmbeddingProvider 接口 + 确定性 FakeEmbedding"
```

---

## Task 2: MemoryStore 接口 + FakeMemoryStore

**Files:**
- Create: `server/src/memory/store.ts`
- Create: `server/src/memory/fake-memory-store.ts`
- Test: `server/src/memory/fake-memory-store.test.ts`

- [ ] **Step 1: 写接口与类型(无测试,被下一步测试驱动)**

`server/src/memory/store.ts`:
```ts
import type { PersonaId } from '../types.js'

export type MemoryKind = 'episode' | 'fact' | 'insight'

export interface MemoryRecord {
  id: string
  personaId: PersonaId
  kind: MemoryKind
  content: string
  importance: number
  gameId: number | null
  createdAt: string
  supersededAt: string | null
}

export interface MemoryInput {
  personaId: PersonaId
  kind: MemoryKind
  content: string
  importance: number
  gameId: number | null
  createdAt: string
}

export interface MemoryStore {
  /** 写入。episode 廉价 append;fact/insight 触发去重/作废。返回新记录 id */
  record(e: MemoryInput): Promise<string>
  /** 注入用检索。fact/insight 走语义+recency 融合;排除已作废 */
  retrieve(personaId: PersonaId, query: string, limit: number, kinds?: MemoryKind[]): Promise<MemoryRecord[]>
  /** 控制台浏览。默认排除已作废 */
  list(filter: { personaId?: PersonaId; kind?: MemoryKind; includeSuperseded?: boolean }): Promise<MemoryRecord[]>
  /** 控制台编辑。content 变更时重算嵌入(由实现负责) */
  update(id: string, patch: { content?: string; importance?: number }): Promise<void>
  /** 控制台删除 */
  remove(id: string): Promise<void>
}
```

- [ ] **Step 2: 写失败测试**

`server/src/memory/fake-memory-store.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { FakeMemoryStore } from './fake-memory-store.js'

const t0 = Date.parse('2026-06-20T00:00:00.000Z')

function freshStore() {
  let clock = t0
  const store = new FakeMemoryStore(() => clock)
  return { store, tick: (ms: number) => { clock += ms } }
}

describe('FakeMemoryStore', () => {
  it('record 返回 id,list 能查回', async () => {
    const { store } = freshStore()
    const id = await store.record({ personaId: 'laopaoer', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: 1, createdAt: new Date(t0).toISOString() })
    expect(id).toBeTruthy()
    const rows = await store.list({ personaId: 'laopaoer' })
    expect(rows).toHaveLength(1)
    expect(rows[0].content).toBe('爱走当头炮')
  })

  it('retrieve 按 kinds 过滤,episode 不混入 fact/insight 检索', async () => {
    const { store } = freshStore()
    await store.record({ personaId: 'coach', kind: 'episode', content: '这步软了', importance: 1, gameId: 1, createdAt: new Date(t0).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: new Date(t0).toISOString() })
    const got = await store.retrieve('coach', '残局', 5, ['fact', 'insight'])
    expect(got.map(r => r.kind)).toEqual(['fact'])
  })

  it('retrieve 按 recency+importance 排序(新的/重要的靠前)', async () => {
    const { store, tick } = freshStore()
    await store.record({ personaId: 'coach', kind: 'fact', content: '旧事实', importance: 3, gameId: 1, createdAt: new Date(t0).toISOString() })
    tick(1000 * 60 * 60 * 24) // 一天后
    await store.record({ personaId: 'coach', kind: 'fact', content: '新事实', importance: 3, gameId: 2, createdAt: new Date(t0 + 86400000).toISOString() })
    const got = await store.retrieve('coach', '事实', 2, ['fact'])
    expect(got[0].content).toBe('新事实')
  })

  it('update 改 content;remove 删除', async () => {
    const { store } = freshStore()
    const id = await store.record({ personaId: 'coach', kind: 'fact', content: 'A', importance: 3, gameId: null, createdAt: new Date(t0).toISOString() })
    await store.update(id, { content: 'B' })
    expect((await store.list({ personaId: 'coach' }))[0].content).toBe('B')
    await store.remove(id)
    expect(await store.list({ personaId: 'coach' })).toHaveLength(0)
  })

  it('list includeSuperseded 控制可见性', async () => {
    const { store } = freshStore()
    const id = await store.record({ personaId: 'coach', kind: 'fact', content: '旧认知', importance: 3, gameId: null, createdAt: new Date(t0).toISOString() })
    await store.markSuperseded(id, new Date(t0).toISOString())
    expect(await store.list({ personaId: 'coach' })).toHaveLength(0)
    expect(await store.list({ personaId: 'coach', includeSuperseded: true })).toHaveLength(1)
    // 已作废不参与 retrieve
    expect(await store.retrieve('coach', '认知', 5, ['fact'])).toHaveLength(0)
  })
})
```

- [ ] **Step 3: 运行测试,确认失败**

Run: `npm -w server test -- fake-memory-store`
Expected: FAIL —— 找不到 `FakeMemoryStore`。

- [ ] **Step 4: 写实现**

`server/src/memory/fake-memory-store.ts`:
```ts
import type { MemoryStore, MemoryRecord, MemoryInput, MemoryKind } from './store.js'
import type { PersonaId } from '../types.js'

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14 // 14 天,与原实现一致

/** 内存测试双:append-only,不做语义去重(语义在 SurrealMemoryStore 测)。
 *  retrieve 用 recency+importance(= 降级路径行为),便于断言排序。 */
export class FakeMemoryStore implements MemoryStore {
  private rows: MemoryRecord[] = []
  private seq = 0
  constructor(private now: () => number = () => Date.now()) {}

  async record(e: MemoryInput): Promise<string> {
    const id = `mem:${++this.seq}`
    this.rows.push({ ...e, id, supersededAt: null })
    return id
  }

  async retrieve(personaId: PersonaId, _query: string, limit: number, kinds?: MemoryKind[]): Promise<MemoryRecord[]> {
    const t = this.now()
    return this.rows
      .filter(r => r.personaId === personaId && !r.supersededAt && (!kinds || kinds.includes(r.kind)))
      .map(r => {
        const recency = Math.pow(0.5, (t - Date.parse(r.createdAt)) / RECENCY_HALFLIFE_MS)
        return { r, score: recency + r.importance / 5 }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.r)
  }

  async list(filter: { personaId?: PersonaId; kind?: MemoryKind; includeSuperseded?: boolean }): Promise<MemoryRecord[]> {
    return this.rows.filter(r =>
      (!filter.personaId || r.personaId === filter.personaId) &&
      (!filter.kind || r.kind === filter.kind) &&
      (filter.includeSuperseded || !r.supersededAt))
  }

  async update(id: string, patch: { content?: string; importance?: number }): Promise<void> {
    const row = this.rows.find(r => r.id === id)
    if (!row) return
    if (patch.content !== undefined) row.content = patch.content
    if (patch.importance !== undefined) row.importance = patch.importance
  }

  async remove(id: string): Promise<void> {
    this.rows = this.rows.filter(r => r.id !== id)
  }

  /** 测试辅助:标记作废(生产由 SurrealMemoryStore 的 judge 路径触发) */
  async markSuperseded(id: string, at: string): Promise<void> {
    const row = this.rows.find(r => r.id === id)
    if (row) row.supersededAt = at
  }
}
```

- [ ] **Step 5: 运行测试,确认通过**

Run: `npm -w server test -- fake-memory-store`
Expected: PASS(5 个用例)。

- [ ] **Step 6: Commit**

```bash
git add server/src/memory/store.ts server/src/memory/fake-memory-store.ts server/src/memory/fake-memory-store.test.ts
git commit -m "feat(memory): MemoryStore 接口 + 内存 FakeMemoryStore(测试双)"
```

---

## Task 3: memory-judge(LLM 判 merge/supersede/keep)

**Files:**
- Create: `server/src/memory/memory-judge.ts`
- Test: `server/src/memory/memory-judge.test.ts`

- [ ] **Step 1: 写失败测试**

`server/src/memory/memory-judge.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { judgeMemory, parseJudge } from './memory-judge.js'
import { FakeLLM } from '../llm/fake.js'

describe('parseJudge', () => {
  it('解析 merge + 归并文本', () => {
    expect(parseJudge('merge: 爱走当头炮,且常接马后炮')).toEqual({ action: 'merge', merged: '爱走当头炮,且常接马后炮' })
  })
  it('解析 supersede', () => {
    expect(parseJudge('supersede')).toEqual({ action: 'supersede' })
  })
  it('解析 keep', () => {
    expect(parseJudge('keep')).toEqual({ action: 'keep' })
  })
  it('无法识别时回退 keep(安全:不动旧记忆)', () => {
    expect(parseJudge('啊我不知道')).toEqual({ action: 'keep' })
  })
})

describe('judgeMemory', () => {
  it('把已有/新记忆喂给 LLM 并解析其裁决', async () => {
    const llm = new FakeLLM(['supersede'])
    const r = await judgeMemory(llm, '残局易急躁', '残局变稳健了')
    expect(r).toEqual({ action: 'supersede' })
    // 确认 prompt 里带了两条内容
    const sent = llm.calls[0].messages.map(m => m.content).join('\n')
    expect(sent).toContain('残局易急躁')
    expect(sent).toContain('残局变稳健了')
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm -w server test -- memory-judge`
Expected: FAIL —— 找不到 `memory-judge.js`。

- [ ] **Step 3: 写实现**

`server/src/memory/memory-judge.ts`:
```ts
import type { LLMProvider } from '../llm/provider.js'

export type JudgeResult =
  | { action: 'merge'; merged: string }
  | { action: 'supersede' }
  | { action: 'keep' }

/** 解析裁决文本。容忍偏差:无法识别一律回退 keep(最安全:既不合并也不作废)。 */
export function parseJudge(raw: string): JudgeResult {
  const text = raw.trim()
  const lower = text.toLowerCase()
  if (lower.startsWith('merge')) {
    const merged = text.replace(/^merge\s*[:：]?\s*/i, '').trim()
    return merged ? { action: 'merge', merged } : { action: 'keep' }
  }
  if (lower.startsWith('supersede')) return { action: 'supersede' }
  if (lower.startsWith('keep')) return { action: 'keep' }
  return { action: 'keep' }
}

/** 让 LLM 判断"新记忆 vs 最相似的已有记忆"的关系。 */
export async function judgeMemory(llm: LLMProvider, existing: string, incoming: string): Promise<JudgeResult> {
  const raw = await llm.chat([
    {
      role: 'system',
      content: '你在维护一个对弈对手的人设记忆库。给你"已有记忆"和"新记忆",判断二者关系并只输出一行:\n'
        + '- 若是同一事实的复述/细化 → 输出 "merge: <合并后的一句话>"\n'
        + '- 若新记忆与旧记忆矛盾、是认知更新 → 输出 "supersede"\n'
        + '- 若相关但确为不同的事实 → 输出 "keep"\n'
        + '只输出这一行,不要解释。',
    },
    { role: 'user', content: `已有记忆:${existing}\n新记忆:${incoming}` },
  ], { disableThinking: false, maxTokens: 120 })
  return parseJudge(raw)
}
```

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm -w server test -- memory-judge`
Expected: PASS(5 个用例)。

- [ ] **Step 5: Commit**

```bash
git add server/src/memory/memory-judge.ts server/src/memory/memory-judge.test.ts
git commit -m "feat(memory): memory-judge —— LLM 判 merge/supersede/keep + 解析(默认回退 keep)"
```

---

## Task 4: 迁移 chat-engine 到异步 MemoryStore

**Files:**
- Modify: `server/src/chat/chat-engine.ts`(行 2、11、98、77、134、142)
- Modify: `server/src/chat/chat-engine.test.ts`(mock 由 PersonaMemoryRepo 改 FakeMemoryStore)

- [ ] **Step 1: 改依赖类型与 import**

`server/src/chat/chat-engine.ts` 顶部:把
```ts
import type { PersonaMemoryRepo } from '../memory/persona-memory-repo.js'
```
改为
```ts
import type { MemoryStore } from '../memory/store.js'
```
并把 `ChatEngineDeps` 里
```ts
  mem: PersonaMemoryRepo
```
改为
```ts
  mem: MemoryStore
```

- [ ] **Step 2: episode 写入改 await record**

把 `chat-engine.ts:98` 的
```ts
        this.deps.mem.add({
          personaId: id,
          kind: 'episode',
          content: text,
          importance: 1,
          gameId: stim.gameId,
          createdAt: line.ts,
        })
```
改为
```ts
        await this.deps.mem.record({
          personaId: id,
          kind: 'episode',
          content: text,
          importance: 1,
          gameId: stim.gameId,
          createdAt: line.ts,
        })
```
(所在的 `for (const id of speakers)` 循环体已在 async `onStimulus` 内,可直接 await。)

- [ ] **Step 3: plan() 改 async,retrieve 改 await 且去掉 now 参数**

把方法签名
```ts
  private plan(p: Persona, stim: Stimulus, context: RecentEntry[]): {
    messages: { role: 'system' | 'user'; content: string }[]
    addressee: ChatLine['addressee']
  } {
```
改为
```ts
  private async plan(p: Persona, stim: Stimulus, context: RecentEntry[]): Promise<{
    messages: { role: 'system' | 'user'; content: string }[]
    addressee: ChatLine['addressee']
  }> {
```
把 `plan()` 内
```ts
    const facts = this.deps.mem
      .retrieve(p.id, stim.moveZh ?? stim.humanText ?? stim.kind, 3, this.deps.now, ['fact', 'insight'])
      .map(m => '· ' + m.content).join('\n') || '(还不了解)'
```
改为
```ts
    const facts = (await this.deps.mem
      .retrieve(p.id, stim.moveZh ?? stim.humanText ?? stim.kind, 3, ['fact', 'insight']))
      .map(m => '· ' + m.content).join('\n') || '(还不了解)'
```

- [ ] **Step 4: plan() 调用点加 await**

把 `chat-engine.ts:77` 的
```ts
        const plan = this.plan(persona, stim, context)
```
改为
```ts
        const plan = await this.plan(persona, stim, context)
```

- [ ] **Step 5: 改既有测试用 FakeMemoryStore**

`server/src/chat/chat-engine.test.ts`:把构造 `ChatEngine` 时传入的 `mem`(原 `new PersonaMemoryRepo(db)` 或内联假对象)替换为 `new FakeMemoryStore(() => <测试时钟>)`。
- 顶部加 `import { FakeMemoryStore } from '../memory/fake-memory-store.js'`。
- 删除该测试文件里对 `PersonaMemoryRepo`/`openDb` 仅为记忆而建的引用(若有)。
- 若有断言"记忆被写入"的用例,改为 `await mem.list({ personaId })` 断言。

(具体替换以该文件现状为准;原则:任何 `.add(`→无需改测试断言名,因 FakeMemoryStore 暴露 `list`;mem 现在是 async,但 ChatEngine 内部已 await,测试对 ChatEngine 的调用方式不变。)

- [ ] **Step 6: 运行 chat-engine 测试,确认通过**

Run: `npm -w server test -- chat-engine`
Expected: PASS(原有用例数不变;若有记忆断言用例已改为 async 形式)。

- [ ] **Step 7: Commit**

```bash
git add server/src/chat/chat-engine.ts server/src/chat/chat-engine.test.ts
git commit -m "refactor(chat): ChatEngine 改用异步 MemoryStore(record/retrieve),plan() 转 async"
```

---

## Task 5: 迁移 reflection 到异步 MemoryStore

**Files:**
- Modify: `server/src/memory/reflection.ts`(行 1、59、82)
- Modify: `server/src/memory/reflection.test.ts`

- [ ] **Step 1: 改 import 与参数类型**

`server/src/memory/reflection.ts`:把
```ts
import type { PersonaMemoryRepo } from './persona-memory-repo.js'
```
改为
```ts
import type { MemoryStore } from './store.js'
```
把 `reflect` 的参数
```ts
  repo: PersonaMemoryRepo; llm: LLMProvider; personaId: PersonaId; gameId: number; now: () => number
```
改为
```ts
  store: MemoryStore; llm: LLMProvider; personaId: PersonaId; gameId: number; now: () => number
```
并把函数体首行解构
```ts
  const { repo, llm, personaId, now, playerSummary } = args
```
改为
```ts
  const { store, llm, personaId, now, playerSummary } = args
```

- [ ] **Step 2: 写入改 await record**

把循环
```ts
  for (const entry of entries) {
    repo.add({
      personaId,
      kind: entry.kind,
      content: entry.content,
      importance: entry.importance,
      gameId: args.gameId,
      createdAt,
    })
  }
```
改为
```ts
  for (const entry of entries) {
    await store.record({
      personaId,
      kind: entry.kind,
      content: entry.content,
      importance: entry.importance,
      gameId: args.gameId,
      createdAt,
    })
  }
```

- [ ] **Step 3: 改既有测试**

`server/src/memory/reflection.test.ts`:
- 顶部 `import { FakeMemoryStore } from './fake-memory-store.js'`。
- 把传给 `reflect` 的 `repo: new PersonaMemoryRepo(db)` 改为 `store: new FakeMemoryStore(() => <时钟>)`。
- 断言"写入了 N 条记忆"改为 `expect(await store.list({ personaId })).toHaveLength(N)`(原若用 `repo.byPersona` 断言)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm -w server test -- reflection`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/memory/reflection.ts server/src/memory/reflection.test.ts
git commit -m "refactor(memory): reflect 改用异步 MemoryStore.record"
```

---

## Task 6: DashscopeEmbedding(生产嵌入)

**Files:**
- Create: `server/src/llm/dashscope-embedding.ts`
- Test: `server/src/llm/dashscope-embedding.test.ts`

- [ ] **Step 1: 写失败测试(注入假 OpenAI 客户端,不打网络)**

`server/src/llm/dashscope-embedding.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { DashscopeEmbedding } from './dashscope-embedding.js'

describe('DashscopeEmbedding', () => {
  it('调用注入的 client 并把响应映射为向量数组', async () => {
    const fakeClient = {
      embeddings: {
        create: async (body: any) => ({
          data: body.input.map((_: string, i: number) => ({ embedding: [i, i + 1, i + 2] })),
        }),
      },
    }
    const emb = new DashscopeEmbedding('text-embedding-v3', 3, fakeClient as any)
    const vecs = await emb.embed(['a', 'b'])
    expect(vecs).toEqual([[0, 1, 2], [1, 2, 3]])
    expect(emb.dimension).toBe(3)
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm -w server test -- dashscope-embedding`
Expected: FAIL —— 找不到 `dashscope-embedding.js`。

- [ ] **Step 3: 写实现**

`server/src/llm/dashscope-embedding.ts`:
```ts
import OpenAI from 'openai'
import type { EmbeddingProvider } from './embedding.js'

/** DashScope text-embedding-v3(OpenAI 兼容 /embeddings)。
 *  维度可配置(v3 支持 1024/768/512 等,以实际响应为准);默认 1024。 */
export class DashscopeEmbedding implements EmbeddingProvider {
  private client: Pick<OpenAI['embeddings'], 'create'> extends never ? never : { embeddings: { create: (b: any) => Promise<any> } }

  constructor(
    private model = process.env.EMBEDDING_MODEL ?? 'text-embedding-v3',
    public readonly dimension = Number(process.env.EMBEDDING_DIM ?? 1024),
    client?: { embeddings: { create: (b: any) => Promise<any> } },
  ) {
    if (client) {
      this.client = client
    } else {
      const apiKey = process.env.DASHSCOPE_API_KEY
      const baseURL = process.env.DASHSCOPE_BASE_URL
      if (!apiKey || !baseURL) throw new Error('缺少 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL(见 .env)')
      this.client = new OpenAI({ apiKey, baseURL }) as any
    }
  }

  async embed(texts: string[]): Promise<number[][]> {
    const resp: any = await this.client.embeddings.create({
      model: this.model,
      input: texts,
      dimensions: this.dimension,
    })
    return resp.data.map((d: any) => d.embedding as number[])
  }
}
```
注:`client` 字段类型可简化为 `private client: { embeddings: { create: (b: any) => Promise<any> } }`(上面的条件类型仅为说明,实现时用简化版即可)。

- [ ] **Step 4: 运行测试,确认通过**

Run: `npm -w server test -- dashscope-embedding`
Expected: PASS。

- [ ] **Step 5: Commit**

```bash
git add server/src/llm/dashscope-embedding.ts server/src/llm/dashscope-embedding.test.ts
git commit -m "feat(memory): DashscopeEmbedding(text-embedding-v3,维度可配置,client 可注入)"
```

---

## Task 7: SurrealMemoryStore(生产实现 + 集成测试)

**Files:**
- Create: `server/src/memory/surreal-memory-store.ts`
- Test: `server/src/memory/surreal-memory-store.test.ts`

实现要点:连接时建表/索引(DIMENSION 取 `embedding.dimension`);`record` 对 fact/insight 走 embed→KNN→judge;`retrieve` 走 KNN + recency/importance 融合;embed 失败降级(存 NONE / 退 recency)。

- [ ] **Step 1: 写集成测试(本机起 Surreal,缺二进制则跳过)**

`server/src/memory/surreal-memory-store.test.ts`:
```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { Surreal } from 'surrealdb'
import { SurrealMemoryStore } from './surreal-memory-store.js'
import { FakeEmbedding } from '../llm/embedding.js'
import { FakeLLM } from '../llm/fake.js'

const BIN = join(homedir(), '.surrealdb', 'surreal')
const PORT = 8123
const URL = `ws://127.0.0.1:${PORT}`
const hasBin = existsSync(BIN)

describe.skipIf(!hasBin)('SurrealMemoryStore (集成)', () => {
  let proc: ChildProcess
  let clock = Date.parse('2026-06-20T00:00:00.000Z')

  beforeAll(async () => {
    proc = spawn(BIN, ['start', 'memory', '--bind', `127.0.0.1:${PORT}`, '--user', 'root', '--pass', 'root'], { stdio: 'ignore' })
    // 轮询直到可连接(最多 ~5s)
    for (let i = 0; i < 25; i++) {
      try { const db = new Surreal(); await db.connect(URL); await db.close(); break }
      catch { await new Promise(r => setTimeout(r, 200)) }
    }
  }, 15000)

  afterAll(() => { proc?.kill() })

  function makeStore(llm = new FakeLLM(['keep'])) {
    return new SurrealMemoryStore({
      url: URL, namespace: 'test', database: 'test', username: 'root', password: 'root',
      embedding: new FakeEmbedding(16), llm, now: () => clock,
    })
  }

  it('record fact 后 retrieve 能语义召回,且 episode 不混入', async () => {
    const store = makeStore()
    await store.connect()
    await store.record({ personaId: 'coach', kind: 'episode', content: '这步软了', importance: 1, gameId: 1, createdAt: new Date(clock).toISOString() })
    await store.record({ personaId: 'coach', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: new Date(clock).toISOString() })
    const got = await store.retrieve('coach', '残局急躁', 5, ['fact', 'insight'])
    expect(got).toHaveLength(1)
    expect(got[0].content).toBe('残局易急躁')
    await store.close()
  })

  it('judge=supersede 时旧条作废、retrieve 不再返回、list(includeSuperseded) 仍可见', async () => {
    const store = makeStore(new FakeLLM(['supersede']))
    await store.connect()
    await store.record({ personaId: 'p1', kind: 'fact', content: '残局易急躁', importance: 3, gameId: 1, createdAt: new Date(clock).toISOString() })
    // 第二条与第一条相似度高(同字多)→ 触发 judge → supersede
    await store.record({ personaId: 'p1', kind: 'fact', content: '残局已变稳健', importance: 3, gameId: 2, createdAt: new Date(clock).toISOString() })
    const active = await store.retrieve('p1', '残局', 5, ['fact'])
    expect(active.map(r => r.content)).toContain('残局已变稳健')
    expect(active.map(r => r.content)).not.toContain('残局易急躁')
    const all = await store.list({ personaId: 'p1', includeSuperseded: true })
    expect(all.some(r => r.content === '残局易急躁' && r.supersededAt)).toBe(true)
    await store.close()
  })

  it('update 改 content 后能用新内容召回;remove 真删', async () => {
    const store = makeStore()
    await store.connect()
    const id = await store.record({ personaId: 'p2', kind: 'fact', content: '偏好屏风马', importance: 3, gameId: null, createdAt: new Date(clock).toISOString() })
    await store.update(id, { content: '改打中炮' })
    expect((await store.list({ personaId: 'p2' }))[0].content).toBe('改打中炮')
    await store.remove(id)
    expect(await store.list({ personaId: 'p2' })).toHaveLength(0)
    await store.close()
  })

  it('嵌入失败降级:照存(embedding=NONE)、retrieve 退回 recency 不崩', async () => {
    const failing = { embed: async () => { throw new Error('boom') }, dimension: 16 }
    const store = new SurrealMemoryStore({
      url: URL, namespace: 'test', database: 'test2', username: 'root', password: 'root',
      embedding: failing as any, llm: new FakeLLM(['keep']), now: () => clock,
    })
    await store.connect()
    const id = await store.record({ personaId: 'p3', kind: 'fact', content: '爱走当头炮', importance: 3, gameId: null, createdAt: new Date(clock).toISOString() })
    expect(id).toBeTruthy()
    const got = await store.retrieve('p3', '当头炮', 5, ['fact'])
    expect(got).toHaveLength(1)
    await store.close()
  })
})
```

- [ ] **Step 2: 运行测试,确认失败**

Run: `npm -w server test -- surreal-memory-store`
Expected: FAIL —— 找不到 `surreal-memory-store.js`(若本机无 `~/.surrealdb/surreal`,整组 skip —— 此时先在装了二进制的机器上跑)。

- [ ] **Step 3: 写实现**

`server/src/memory/surreal-memory-store.ts`:
```ts
import { Surreal } from 'surrealdb'
import type { MemoryStore, MemoryRecord, MemoryInput, MemoryKind } from './store.js'
import type { EmbeddingProvider } from '../llm/embedding.js'
import type { LLMProvider } from '../llm/provider.js'
import type { PersonaId } from '../types.js'
import { judgeMemory } from './memory-judge.js'

const RECENCY_HALFLIFE_MS = 1000 * 60 * 60 * 24 * 14
const SIM_THRESHOLD = 0.85 // 余弦相似度高于此值才触发 judge

export interface SurrealMemoryDeps {
  url: string
  namespace: string
  database: string
  username: string
  password: string
  embedding: EmbeddingProvider
  llm: LLMProvider
  now: () => number
}

interface Row {
  id: string; persona_id: string; kind: MemoryKind; content: string
  importance: number; game_id: number | null; created_at: string; superseded_at: string | null
}

export class SurrealMemoryStore implements MemoryStore {
  private db = new Surreal()
  constructor(private deps: SurrealMemoryDeps) {}

  async connect(): Promise<void> {
    await this.db.connect(this.deps.url)
    await this.db.signin({ username: this.deps.username, password: this.deps.password })
    await this.db.use({ namespace: this.deps.namespace, database: this.deps.database })
    const dim = this.deps.embedding.dimension
    // 幂等建表/索引;DIMENSION 取嵌入维度
    await this.db.query(`
      DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;
      DEFINE FIELD IF NOT EXISTS persona_id    ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS kind          ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS content       ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS importance    ON memory TYPE int;
      DEFINE FIELD IF NOT EXISTS game_id       ON memory TYPE option<int>;
      DEFINE FIELD IF NOT EXISTS created_at    ON memory TYPE string;
      DEFINE FIELD IF NOT EXISTS superseded_at ON memory TYPE option<string>;
      DEFINE FIELD IF NOT EXISTS embedding     ON memory TYPE option<array<float>>;
      DEFINE INDEX IF NOT EXISTS mem_hnsw    ON memory FIELDS embedding HNSW DIMENSION ${dim} DIST COSINE;
      DEFINE INDEX IF NOT EXISTS mem_persona ON memory FIELDS persona_id, kind;
    `)
  }

  async close(): Promise<void> { await this.db.close() }

  /** 失败返回 null(降级:不阻塞写入/检索) */
  private async embedOne(text: string): Promise<number[] | null> {
    try { return (await this.deps.embedding.embed([text]))[0] }
    catch { return null }
  }

  async record(e: MemoryInput): Promise<string> {
    if (e.kind === 'episode') return this.insert(e, null)

    const vec = await this.embedOne(e.content)
    if (!vec) return this.insert(e, null) // 嵌入失败:照存无向量,跳过 judge

    // 找同 persona、同 kind、未作废的最近邻 1 条
    const [nn] = await this.knn(e.personaId, e.kind, vec, 1)
    if (nn && nn.sim >= SIM_THRESHOLD) {
      const verdict = await judgeMemory(this.deps.llm, nn.row.content, e.content)
      if (verdict.action === 'merge') {
        const mvec = await this.embedOne(verdict.merged)
        await this.db.query(
          'UPDATE $id SET content=$c, importance=$imp, embedding=$emb',
          { id: nn.row.id, c: verdict.merged, imp: Math.min(5, nn.row.importance + 1), emb: mvec },
        )
        return nn.row.id
      }
      if (verdict.action === 'supersede') {
        await this.db.query('UPDATE $id SET superseded_at=$at', { id: nn.row.id, at: new Date(this.deps.now()).toISOString() })
        return this.insert(e, vec)
      }
      // keep
    }
    return this.insert(e, vec)
  }

  private async insert(e: MemoryInput, vec: number[] | null): Promise<string> {
    const [res]: any = await this.db.query(
      'CREATE memory CONTENT { persona_id:$p, kind:$k, content:$c, importance:$imp, game_id:$g, created_at:$ts, superseded_at:NONE, embedding:$emb } RETURN id',
      { p: e.personaId, k: e.kind, c: e.content, imp: e.importance, g: e.gameId, ts: e.createdAt, emb: vec },
    )
    return String(res[0].id)
  }

  /** KNN:返回 [{row, sim}],按相似度降序;sim = 1 - cosine_distance */
  private async knn(personaId: string, kind: MemoryKind, vec: number[], k: number): Promise<Array<{ row: Row; sim: number }>> {
    const [res]: any = await this.db.query(
      `SELECT *, vector::distance::knn() AS dist FROM memory
       WHERE persona_id=$p AND kind=$k AND superseded_at IS NONE AND embedding IS NOT NONE
         AND embedding <|${k}|> $vec
       ORDER BY dist ASC`,
      { p: personaId, k: kind, vec },
    )
    return (res ?? []).map((r: any) => ({ row: this.norm(r), sim: 1 - r.dist }))
  }

  async retrieve(personaId: PersonaId, query: string, limit: number, kinds: MemoryKind[] = ['fact', 'insight']): Promise<MemoryRecord[]> {
    const vec = await this.embedOne(query)
    const t = this.deps.now()
    // 候选:取每个 kind 的近邻并入(无向量时退回 recency 全量)
    let rows: Array<{ row: Row; sim: number }> = []
    if (vec) {
      for (const k of kinds) rows.push(...await this.knn(personaId, k, vec, Math.max(limit, 5)))
    } else {
      const [res]: any = await this.db.query(
        'SELECT * FROM memory WHERE persona_id=$p AND superseded_at IS NONE AND kind IN $kinds',
        { p: personaId, kinds },
      )
      rows = (res ?? []).map((r: any) => ({ row: this.norm(r), sim: 0 }))
    }
    return rows
      .map(({ row, sim }) => {
        const recency = Math.pow(0.5, (t - Date.parse(row.created_at)) / RECENCY_HALFLIFE_MS)
        return { row, score: sim + recency + row.importance / 5 }
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => this.toRecord(s.row))
  }

  async list(filter: { personaId?: PersonaId; kind?: MemoryKind; includeSuperseded?: boolean }): Promise<MemoryRecord[]> {
    const wh: string[] = []
    const vars: any = {}
    if (filter.personaId) { wh.push('persona_id=$p'); vars.p = filter.personaId }
    if (filter.kind) { wh.push('kind=$k'); vars.k = filter.kind }
    if (!filter.includeSuperseded) wh.push('superseded_at IS NONE')
    const clause = wh.length ? 'WHERE ' + wh.join(' AND ') : ''
    const [res]: any = await this.db.query(`SELECT * FROM memory ${clause} ORDER BY created_at DESC`, vars)
    return (res ?? []).map((r: any) => this.toRecord(this.norm(r)))
  }

  async update(id: string, patch: { content?: string; importance?: number }): Promise<void> {
    const sets: string[] = []
    const vars: any = { id }
    if (patch.content !== undefined) {
      sets.push('content=$c'); vars.c = patch.content
      const vec = await this.embedOne(patch.content)
      sets.push('embedding=$emb'); vars.emb = vec
    }
    if (patch.importance !== undefined) { sets.push('importance=$imp'); vars.imp = patch.importance }
    if (!sets.length) return
    await this.db.query(`UPDATE $id SET ${sets.join(', ')}`, vars)
  }

  async remove(id: string): Promise<void> {
    await this.db.query('DELETE $id', { id })
  }

  /** SurrealDB 返回的 id 可能是 RecordId 对象,统一转字符串 */
  private norm(r: any): Row {
    return { ...r, id: String(r.id) }
  }

  private toRecord(r: Row): MemoryRecord {
    return {
      id: r.id, personaId: r.persona_id as PersonaId, kind: r.kind, content: r.content,
      importance: r.importance, gameId: r.game_id, createdAt: r.created_at, supersededAt: r.superseded_at,
    }
  }
}
```

- [ ] **Step 4: 运行测试,确认通过(在装有 surreal 的本机)**

Run: `npm -w server test -- surreal-memory-store`
Expected: PASS(4 个用例)。
**若 SurrealQL 报语法错**(KNN 操作符 `<|k|>`、`vector::distance::knn()`、`CREATE ... RETURN id`、`UPDATE $id`、`IS NONE`):用 `~/.surrealdb/surreal sql` 交互式逐句核对 v3.1.5 语法并就地修正。这些是已知需对版本验证的点。

- [ ] **Step 5: Commit**

```bash
git add server/src/memory/surreal-memory-store.ts server/src/memory/surreal-memory-store.test.ts
git commit -m "feat(memory): SurrealMemoryStore —— HNSW KNN 检索 + 写入时 judge 合并/作废 + 嵌入失败降级"
```

---

## Task 8: ws-server 接线

**Files:**
- Modify: `server/src/ws-server.ts`(行 22、74 区域;reflect 调用处)

- [ ] **Step 1: 改 import**

把 `ws-server.ts:22`
```ts
import { PersonaMemoryRepo } from './memory/persona-memory-repo.js'
```
改为
```ts
import { SurrealMemoryStore } from './memory/surreal-memory-store.js'
import { FakeMemoryStore } from './memory/fake-memory-store.js'
import { DashscopeEmbedding } from './llm/dashscope-embedding.js'
```

- [ ] **Step 2: 构造 store(失败降级为 FakeMemoryStore,不阻塞启动)**

把 `ws-server.ts:74` 的
```ts
  const pmem = new PersonaMemoryRepo(db)
```
替换为(放在 `llm` 已确定之后,因为 store 需要 llm 做 judge —— 若顺序上 llm 在其后,把本段移到 llm 构造之后):
```ts
  // 记忆:优先 SurrealDB 语义记忆;连接/配置失败则降级为内存 store(聊天/反思照常,只是不持久、不语义)
  let mem: import('./memory/store.js').MemoryStore
  try {
    const embedding = new DashscopeEmbedding()
    const surreal = new SurrealMemoryStore({
      url: process.env.SURREAL_URL ?? 'ws://127.0.0.1:8000',
      namespace: process.env.SURREAL_NS ?? 'weiguan',
      database: process.env.SURREAL_DB ?? 'weiguan',
      username: process.env.SURREAL_USER ?? 'root',
      password: process.env.SURREAL_PASS ?? 'root',
      embedding,
      llm,
      now: () => Date.now(),
    })
    await surreal.connect()
    mem = surreal
  } catch (err) {
    console.warn('SurrealDB 记忆不可用,降级为内存记忆(不持久):', (err as Error).message)
    mem = new FakeMemoryStore(() => Date.now())
  }
```
注:`mem` 用在 `new ChatEngine({ ..., mem, ... })`,把原 `mem: pmem` 改为 `mem`。确认 `createServer`/包裹函数已是 `async`(`ws-server.ts:60` 上文已有 `await`),可直接 `await surreal.connect()`;若该函数非 async,改其签名为 `async`。`llm` 需在此段之前完成构造(参见 `ws-server.ts:76-86`),如顺序不符则把 llm 构造上移。

- [ ] **Step 3: 更新 reflect 调用(repo → store)**

把 `reflectGame` 内
```ts
    for (const p of spectators()) {
      reflect({ repo: pmem, llm, personaId: p.id, gameId, now: () => Date.now(), playerSummary })
        .catch(() => { /* 反思失败静默忽略 */ })
    }
```
改为
```ts
    for (const p of spectators()) {
      reflect({ store: mem, llm, personaId: p.id, gameId, now: () => Date.now(), playerSummary })
        .catch(() => { /* 反思失败静默忽略 */ })
    }
```

- [ ] **Step 4: typecheck + 既有 ws/集成测试**

Run: `npm -w server run build`
Expected: tsc 通过,无类型错误。
Run: `npm -w server test`
Expected: 全套通过(见 Task 9 确认数量)。

- [ ] **Step 5: Commit**

```bash
git add server/src/ws-server.ts
git commit -m "feat(memory): ws-server 接入 SurrealMemoryStore(失败降级内存),reflect 走 store"
```

---

## Task 9: 全量验证 + 收尾

- [ ] **Step 1: 跑全套 server 测试**

Run: `npm -w server test`
Expected: 全绿。基线为 209 个;本计划新增 `embedding`(3)、`fake-memory-store`(5)、`memory-judge`(5)、`dashscope-embedding`(1)、`surreal-memory-store`(4,若本机有 surreal 则跑、否则 skip)。`chat-engine`/`reflection` 用例数不变。**确认无因 async 改造而失败的旧用例。**

- [ ] **Step 2: 跑 web 测试(确认未波及)**

Run: `npm -w web test`
Expected: 18 个通过。

- [ ] **Step 3: 端到端冒烟(真起 Surreal + server)**

Run:
```bash
npm -w server run dev
```
另一终端走一局(或用现有前端 `npm -w web run dev`),局末确认:server 日志无 Surreal 报错;再次开局时旁观者发言里能体现"记得这位棋手"(facts 注入生效)。
Expected: 无崩溃;`~/.surrealdb/surreal sql --endpoint ws://127.0.0.1:8000 --user root --pass root --ns weiguan --db weiguan` 执行 `SELECT count() FROM memory GROUP ALL;` 能看到记忆行。

- [ ] **Step 4: 标记旧 repo 为废弃(不删,留待控制台子项目确认无引用后清理)**

在 `server/src/memory/persona-memory-repo.ts` 顶部加注释:
```ts
/** @deprecated 已被 MemoryStore(SurrealMemoryStore)取代,不再被生产代码引用。
 *  待控制台子项目完成、确认无引用后删除。 */
```

- [ ] **Step 5: Commit**

```bash
git add server/src/memory/persona-memory-repo.ts
git commit -m "chore(memory): 标记 PersonaMemoryRepo 废弃(已由 MemoryStore 取代)"
```

---

## Self-Review 记录

- **Spec 覆盖**:① MemoryStore 接口→Task 2;② 只 fact/insight 向量化、episode append→Task 2(Fake)/Task 7(record 内 `if kind==='episode'`);③ EmbeddingProvider+Fake+Dashscope→Task 1/6;④ SurrealDB schema/HNSW→Task 7 connect();⑤ 写入时 merge/supersede/keep→Task 3+Task 7;⑥ 读取 KNN+recency 融合→Task 7 retrieve;⑦ 降级(嵌入失败)→Task 7 record/retrieve + Task 8 store 降级;⑧ 部署独立进程+dev→Task 0;⑨ 全新开始不迁移→无迁移任务(符合);⑩ 三处调用点 async→Task 4/5/8;⑪ 测试策略→各 Task TDD + Task 9。全部有对应任务。
- **占位扫描**:SurrealQL 语法(KNN/CREATE RETURN/IS NONE)在 Task 7 Step 4 显式列为"需对 v3.1.5 验证并就地修正",非占位而是真实验证步骤;`text-embedding-v3` 维度以响应为准、默认 1024。无 TODO/TBD。
- **类型一致**:`MemoryStore`/`MemoryRecord`/`MemoryInput`/`MemoryKind` 全程一致;`EmbeddingProvider.embed/dimension`、`judgeMemory/parseJudge/JudgeResult`、`SurrealMemoryDeps` 在定义与使用处签名一致;`record/retrieve/list/update/remove` 五方法签名贯穿 Fake 与 Surreal 两实现一致(retrieve 已去掉旧的 `now` 参数)。
