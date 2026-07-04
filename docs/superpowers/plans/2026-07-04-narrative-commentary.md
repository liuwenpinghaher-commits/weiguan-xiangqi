# 对局叙事点评引擎 v1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把观棋弹幕从"逐步反应"升级为"有层次的观棋解说"——着法点评(微观)、局势总评(中观)、历史回顾(叙事)、展望预判(前瞻)按时机分配,快走短评不滞后、停顿深评有底蕴。

**Architecture:** 三层改动。(1) 刺激层:`StimulusKind` 增 `turning_point`(评分大摆动)与 `phase_shift`(开→中→残),由 game-session 在既有 swing/phase 计算处顺带触发。(2) 语境层:`ChatEngine` 注入 `GamesRepo`,新增 `buildNarrative(gameId)` 从 `repo.getMoves` 的评分序列实时算"走势+转折点"叙事字符串,供全局/历史点评做原料。(3) 编排层:高频 `move` 刺激保留最近 2 步(放宽丢旧,滞后≤2 步);`idle` 轮换出局势/历史/展望三种深度点评;`turning_point`/`phase_shift` 优先不丢;prompt 按 persona 给维度偏好(教练总评、炮儿爷回顾)。

**Tech Stack:** TypeScript (Node ESM), vitest, 现有 ChatEngine/GameSession/GamesRepo。纯文本 LLM(DeepSeek v4-flash)。

---

## File Structure

- `server/src/types.ts` — `StimulusKind` 加两种 kind(改)
- `server/src/chat/narrative.ts` — **新建**:`buildNarrative(moves)` 纯函数,把评分序列转成"走势+转折点"叙事字符串(单一职责、易测)
- `server/src/chat/narrative.test.ts` — **新建**:narrative 纯函数单测
- `server/src/chat/chat-engine.ts` — 保留最近 2 步、注入 repo、维度化 prompt(改)
- `server/src/chat/chat-engine.test.ts` — 新增维度/丢旧用例(改)
- `server/src/session/game-session.ts` — swing 触发 turning_point、phase 变化触发 phase_shift(改)
- `server/src/session/game-session.test.ts` — 新增触发用例(改)
- `server/src/ws-server.ts` — `ChatEngine` 构造传入 `repo`(改一行)

**决策:narrative 独立成纯函数文件** —— 它是"评分序列→叙事文本"的无副作用转换,与 ChatEngine 的状态/LLM 解耦,单独测最省事;ChatEngine 只调它。

---

## Task 1: 放宽丢旧——高频刺激保留最近 2 步,重要刺激不丢

**Files:**
- Modify: `server/src/chat/chat-engine.ts`(onStimulus 与 latestStim 字段)
- Test: `server/src/chat/chat-engine.test.ts`

当前 `onStimulus` 只留"最新 1 条"(`latestStim` 单值)。改为:高频刺激(`move`/`blunder`/`brilliant`)按 gameId 保留最近 2 条待处理、超出丢最旧;其余刺激(`turning_point`/`phase_shift`/`idle`/`human_said`/`long_think`/`topic_open`/`lose_streak`)一律不丢。

- [ ] **Step 1: 写失败测试**

在 `chat-engine.test.ts` 末尾追加(沿用文件顶部已有的 `makeEngine`/`FakeLLM` 等 helper;若无则用文件里现成的构造方式):

```typescript
import { describe, it, expect } from 'vitest'
import { ChatEngine as CE3 } from './chat-engine.js'
import { RuntimeConfig as RC3 } from '../config/runtime-config.js'
import { SettingsRepo as SR3 } from '../store/settings-repo.js'
import { openDb as odb3 } from '../store/db.js'
import { FakeLLM as FL3 } from '../llm/fake.js'
import { FakeMemoryStore as FM3 } from '../memory/fake-memory-store.js'

describe('丢旧保新:高频刺激保留最近2步', () => {
  function mk(caps: string[]) {
    const cfg = new RC3(new SR3(odb3(':memory:')), () => '2026-06-21T00:00:00.000Z')
    const llm = new FL3((msgs) => { const u = msgs.find(m => m.role === 'user'); if (u) caps.push(u.content); return '评' })
    // rng 固定小值使所有候选都过阈值发言,保证每条刺激都产出可观测的 user prompt
    return new CE3({ llm, mem: new FM3(() => 0), cfg, now: () => 0, emit: () => {}, rng: () => 0.01,
      repo: { getMoves: () => [] } as any })
  }

  it('并发 3 个 move 刺激,最旧一个被丢(只处理最近2步)', async () => {
    const caps: string[] = []
    const eng = mk(caps)
    // 不 await,制造并发积压:三条 move 快速入队
    const p1 = eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: '炮二平五', ply: 1, tension: 0.9 } as any)
    const p2 = eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: '马8进7',   ply: 2, tension: 0.9 } as any)
    const p3 = eng.onStimulus({ kind: 'move', gameId: 1, scoreCp: 0, moveZh: '车9平8',   ply: 3, tension: 0.9 } as any)
    await Promise.all([p1, p2, p3])
    const joined = caps.join('\n')
    expect(joined.includes('马8进7')).toBe(true)   // 最近2步:保留
    expect(joined.includes('车9平8')).toBe(true)   // 最近2步:保留
    expect(joined.includes('炮二平五')).toBe(false) // 最旧:被丢
  })

  it('turning_point 刺激不被丢旧规则跳过', async () => {
    const caps: string[] = []
    const eng = mk(caps)
    const p1 = eng.onStimulus({ kind: 'move', gameId: 2, scoreCp: 0, moveZh: '兵三进一', ply: 1, tension: 0.9 } as any)
    const p2 = eng.onStimulus({ kind: 'turning_point', gameId: 2, scoreCp: 200, ply: 2, tension: 0.95 } as any)
    await Promise.all([p1, p2])
    expect(caps.some(u => u.includes('转折') || u.includes('攻守'))).toBe(true) // turning_point 一定被处理
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd server && npx vitest run src/chat/chat-engine.test.ts -t '丢旧保新'`
Expected: FAIL(当前 latestStim 只留最新→"马8进7"也可能被丢;turning_point 分支尚未存在)

- [ ] **Step 3: 实现——高频保留2步、其余不丢**

在 `chat-engine.ts`,把 `private latestStim = new Map<number, Stimulus>()` 替换为按 gameId 的高频刺激滑动窗口,并改 `onStimulus`:

```typescript
  /** 高频刺激(逐手 move/blunder/brilliant)保留窗口大小:走快时最多滞后这么多步,超出丢最旧。 */
  private static readonly HIGH_FREQ_KEEP = 2
  private static readonly HIGH_FREQ_KINDS = new Set(['move', 'blunder', 'brilliant'])
  /** 按 gameId 的高频刺激待处理窗口(FIFO,最多 HIGH_FREQ_KEEP 条);其余刺激不进此窗口、不丢。 */
  private highFreqPending = new Map<number, Stimulus[]>()

  onStimulus(stim: Stimulus): Promise<void> {
    const isHighFreq = ChatEngine.HIGH_FREQ_KINDS.has(stim.kind)
    if (isHighFreq) {
      // 高频:入该局窗口,超出保留数则丢最旧(走快时旧步点评过时,不再生成)
      const win = this.highFreqPending.get(stim.gameId) ?? []
      win.push(stim)
      while (win.length > ChatEngine.HIGH_FREQ_KEEP) win.shift()
      this.highFreqPending.set(stim.gameId, win)
    }
    const run = this.queue.then(() => {
      if (isHighFreq) {
        const win = this.highFreqPending.get(stim.gameId)
        if (!win || !win.includes(stim)) return  // 已被后续走子挤出窗口 → 丢弃
        win.splice(win.indexOf(stim), 1)          // 出窗口,准备处理
      }
      return this.handleStimulus(stim)
    }).catch((err) => {
      console.warn('[chat] onStimulus 处理失败:', (err as Error).message)
    })
    this.queue = run
    return run
  }
```

同时把 `forgetGame` 里 `this.latestStim.delete(gameId)` 改为 `this.highFreqPending.delete(gameId)`。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd server && npx vitest run src/chat/chat-engine.test.ts -t '丢旧保新'`
Expected: 第一个用例 PASS(第二个 turning_point 用例仍 FAIL——分支在 Task 5 加,此步只需第一个过;可先跳过第二个 `it.skip` 直到 Task 5)

- [ ] **Step 5: 提交**

```bash
git add server/src/chat/chat-engine.ts server/src/chat/chat-engine.test.ts
git commit -m "feat(chat): 高频刺激保留最近2步,重要刺激不丢旧"
```

---

## Task 2: 扩展 StimulusKind

**Files:**
- Modify: `server/src/types.ts:113-115`

- [ ] **Step 1: 写失败测试**(类型层,用编译即测——先加消费点)

无独立运行测试;本任务由 Task 4/5 的用例间接验证。直接改类型。

- [ ] **Step 2: 实现**

`types.ts` 的 `StimulusKind` 改为:

```typescript
export type StimulusKind =
  | 'move' | 'blunder' | 'brilliant' | 'long_think'
  | 'lose_streak' | 'idle' | 'human_said' | 'topic_open'
  | 'turning_point' | 'phase_shift'
```

- [ ] **Step 3: 运行 tsc 确认无破坏**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0(仅新增 union 成员,现有 switch/if 分支不受影响)

- [ ] **Step 4: 提交**

```bash
git add server/src/types.ts
git commit -m "feat(types): StimulusKind 增 turning_point/phase_shift"
```

---

## Task 3: narrative 纯函数 + ChatEngine 注入 repo

**Files:**
- Create: `server/src/chat/narrative.ts`
- Create: `server/src/chat/narrative.test.ts`
- Modify: `server/src/chat/chat-engine.ts`(ChatEngineDeps 加 repo)
- Modify: `server/src/ws-server.ts`(构造传 repo)

`repo.getMoves(gameId)` 返回 `{ ply, side, move, fenAfter, scoreCp, byAi }[]`(scoreCp 为红方视角、仅 AI 手有值、人手为 null)。`buildNarrative` 从评分序列生成"走势 + 最大转折点"叙事。

- [ ] **Step 1: 写失败测试**

`server/src/chat/narrative.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildNarrative } from './narrative.js'

describe('buildNarrative', () => {
  it('无有效评分 → 空串', () => {
    expect(buildNarrative([])).toBe('')
    expect(buildNarrative([{ ply: 1, scoreCp: null }])).toBe('')
  })

  it('给出当前走势(红优/黑优/均势)', () => {
    const s = buildNarrative([{ ply: 2, scoreCp: 30 }, { ply: 4, scoreCp: 260 }])
    expect(s).toContain('红')       // 末尾 260 → 红优
    expect(s).toContain('第4手')    // 引用手数
  })

  it('识别最大转折点(相邻评分跳变最大处)', () => {
    // 第6手评分从 +20 骤降到 -240(黑方一手扭转)→ 转折点在第6手
    const s = buildNarrative([
      { ply: 2, scoreCp: 10 }, { ply: 4, scoreCp: 20 }, { ply: 6, scoreCp: -240 },
    ])
    expect(s).toContain('第6手')
    expect(s).toContain('转折')
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/chat/narrative.test.ts`
Expected: FAIL("Cannot find module './narrative.js'")

- [ ] **Step 3: 实现 narrative.ts**

```typescript
/** repo.getMoves 的评分片段(红方视角;仅 AI 手有值,人手 null)。 */
export interface ScoredMove { ply: number; scoreCp: number | null }

/** 把评分序列转成一句"走势 + 最大转折点"叙事,供局势总评/历史回顾做原料;无有效评分返回空串。 */
export function buildNarrative(moves: ScoredMove[]): string {
  const pts = moves.filter((m): m is { ply: number; scoreCp: number } => typeof m.scoreCp === 'number')
  if (pts.length === 0) return ''

  const last = pts[pts.length - 1]
  const trend = last.scoreCp > 200 ? '红方占优' : last.scoreCp < -200 ? '黑方占优'
    : last.scoreCp > 60 ? '红方稍好' : last.scoreCp < -60 ? '黑方稍好' : '大体均势'

  // 最大转折点:相邻评分点跳变绝对值最大处
  let turnPly = 0, turnDelta = 0
  for (let i = 1; i < pts.length; i++) {
    const d = Math.abs(pts[i].scoreCp - pts[i - 1].scoreCp)
    if (d > turnDelta) { turnDelta = d; turnPly = pts[i].ply }
  }

  const parts = [`眼下${trend}(至第${last.ply}手)`]
  if (turnPly > 0 && turnDelta >= 150) parts.push(`第${turnPly}手是个转折(评分骤变${Math.round(turnDelta)})`)
  return parts.join(';')
}
```

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/chat/narrative.test.ts`
Expected: PASS(3 个用例)

- [ ] **Step 5: ChatEngineDeps 注入 repo**

`chat-engine.ts` 顶部 import 与 deps:

```typescript
import { buildNarrative, type ScoredMove } from './narrative.js'
// ...
export interface ChatEngineDeps {
  llm: LLMProvider
  mem: MemoryStore
  cfg: RuntimeConfig
  now: () => number
  emit: (line: ChatLine) => void
  rng: () => number
  /** 读历史着法评分,供叙事点评(局势总评/历史回顾)。 */
  repo: { getMoves: (gameId: number) => ScoredMove[] }
}
```

`ws-server.ts` 构造 `new ChatEngine({...})` 处补 `repo,`(该文件已有 `const repo = new GamesRepo(db)`,`getMoves` 兼容 `ScoredMove`)。

- [ ] **Step 6: tsc + 提交**

Run: `cd server && npx tsc --noEmit`  (Expected: exit 0)
Run: `cd web && npx tsc --noEmit`     (Expected: exit 0)

```bash
git add server/src/chat/narrative.ts server/src/chat/narrative.test.ts server/src/chat/chat-engine.ts server/src/ws-server.ts
git commit -m "feat(chat): 新增 buildNarrative 叙事器 + ChatEngine 注入 repo"
```

---

## Task 4: game-session 触发 turning_point / phase_shift

**Files:**
- Modify: `server/src/session/game-session.ts`(playHumanMove 的 AI 着刺激段,约 396-411)
- Test: `server/src/session/game-session.test.ts`

已有 `aiSwing`(评分摆幅)与 `calcPhase(ply)`。在既有 AI 着 `onStimulus` 之后:若 `|aiSwing| >= 250` 追加一条 `turning_point`;若本手 phase 与上手不同追加 `phase_shift`。

- [ ] **Step 1: 写失败测试**

`game-session.test.ts` 追加(沿用文件已有的 harness——注入 fake engine 让 AI 走出指定评分;若 harness 复杂,复用已有 onStimulus 捕获用例的构造):

```typescript
it('AI 着评分大摆动 → 追加 turning_point 刺激', async () => {
  const captured: any[] = []
  // 用文件里既有的 buildSession/fake-engine helper 构造 session,onStimulus: (s) => captured.push(s)
  // 让 AI 手 scoreCp 相对 prevRedCp 摆动 >=250(具体走子/引擎评分按 harness 设定)
  // ...(复用本文件已有的对局构造样板)...
  const kinds = captured.map(s => s.kind)
  expect(kinds).toContain('turning_point')
})
```

(注:本任务测试需接文件既有对局 harness;实现工按同文件 line 142/170/207 的 `onStimulus: (s) => captured.push(s)` 样板补齐驱动。)

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/session/game-session.test.ts -t 'turning_point'`
Expected: FAIL(captured 无 turning_point)

- [ ] **Step 3: 实现**

在 `playHumanMove` 的 AI 着 `this.deps.onStimulus?.({ kind: aiKind, ... byPlayerPersona: true })` 之后追加:

```typescript
    // 叙事刺激:评分大摆动→转折点;阶段切换→局势总评。低频、必处理(不进丢旧窗口)。
    if (aiSwing !== null && Math.abs(aiSwing) >= 250) {
      this.deps.onStimulus?.({
        kind: 'turning_point', gameId, scoreCp: redCp,
        moveZh: aiZh, side: aiSide, ply: aiPly, phase: aiPhase, tension: 0.95,
      })
    }
    const prevPhase = this.lastPhase.get(gameId)
    if (prevPhase !== undefined && prevPhase !== aiPhase) {
      this.deps.onStimulus?.({
        kind: 'phase_shift', gameId, scoreCp: redCp,
        side: aiSide, ply: aiPly, phase: aiPhase, tension: 0.7,
      })
    }
    this.lastPhase.set(gameId, aiPhase)
```

在类字段区加 `private lastPhase = new Map<number, 'opening' | 'midgame' | 'endgame'>()`,并在 `finish`/清理该局处 `this.lastPhase.delete(gameId)`(与既有 prevRedCp 清理同处)。

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/session/game-session.test.ts`
Expected: 新用例 PASS,既有用例不回归

- [ ] **Step 5: 提交**

```bash
git add server/src/session/game-session.ts server/src/session/game-session.test.ts
git commit -m "feat(session): swing 触发 turning_point、阶段切换触发 phase_shift"
```

---

## Task 5: chat-engine 维度化 prompt(idle 轮换 + 新 kind 分支 + persona 偏好)

**Files:**
- Modify: `server/src/chat/chat-engine.ts`(plan() 的 user 分支)
- Test: `server/src/chat/chat-engine.test.ts`

`idle` 从"随口催两句"改为轮换三种深度点评(局势总评/历史回顾/展望),注入 `buildNarrative`;新增 `turning_point`/`phase_shift` 分支;system prompt 按 persona 追加维度偏好(coach→局势总评,laopaoer→历史回顾/掌故)。

- [ ] **Step 1: 写失败测试**

```typescript
describe('多维度点评', () => {
  function mk(caps: string[], moves: any[] = []) {
    const cfg = new RC3(new SR3(odb3(':memory:')), () => '2026-06-21T00:00:00.000Z')
    const llm = new FL3((msgs) => { const u = msgs.find(m => m.role === 'user'); if (u) caps.push(u.content); return '评' })
    return new CE3({ llm, mem: new FM3(() => 0), cfg, now: () => 0, emit: () => {}, rng: () => 0.01,
      repo: { getMoves: () => moves } as any })
  }
  it('turning_point → 点评转折并回顾', async () => {
    const caps: string[] = []
    await mk(caps, [{ ply: 2, scoreCp: 10 }, { ply: 4, scoreCp: 260 }]).onStimulus(
      { kind: 'turning_point', gameId: 1, scoreCp: 260, moveZh: '车四进五', ply: 4, tension: 0.95 } as any)
    expect(caps.some(u => u.includes('转折') || u.includes('攻守易势'))).toBe(true)
  })
  it('phase_shift → 局势总评', async () => {
    const caps: string[] = []
    await mk(caps, [{ ply: 10, scoreCp: 80 }]).onStimulus(
      { kind: 'phase_shift', gameId: 1, scoreCp: 80, ply: 10, phase: 'midgame', tension: 0.7 } as any)
    expect(caps.some(u => u.includes('总评') || u.includes('局势') || u.includes('盘面'))).toBe(true)
  })
  it('idle 注入叙事(走势/转折)', async () => {
    const caps: string[] = []
    await mk(caps, [{ ply: 2, scoreCp: 10 }, { ply: 6, scoreCp: -240 }]).onStimulus(
      { kind: 'idle', gameId: 1, scoreCp: null, tension: 0.5 } as any)
    expect(caps.some(u => u.includes('第6手') || u.includes('转折') || u.includes('走势'))).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `cd server && npx vitest run src/chat/chat-engine.test.ts -t '多维度点评'`
Expected: FAIL(无相应分支)

- [ ] **Step 3: 实现 plan() 分支 + persona 维度偏好**

在 `plan()` 里 `const qual = qualWord(seen)` 之后加叙事:

```typescript
    const narrative = buildNarrative(this.deps.repo.getMoves(stim.gameId))
```

system prompt(`sys`)按 persona 追加一行维度偏好(在既有 sys 拼接末尾追加):

```typescript
      + (p.id === 'coach' ? '你尤其擅长通盘局势总评与战略方向。\n'
       : p.id === 'laopaoer' ? '你见多识广,尤其爱结合掌故、名局、往手回顾来点评。\n'
       : '')
```

在 `plan()` 的 user 分支链中,`else if (stim.kind === 'idle' ...)` 之前插入两个新分支,并改写 idle 分支:

```typescript
    } else if (stim.kind === 'turning_point') {
      user = `局面刚发生转折——第${stim.ply ?? '?'}手${stim.moveZh ?? ''}后,${qual}。${len}。`
        + `点出这个转折:攻守易势在哪、谁抓住了机会、回看前面哪步埋的因;${narrative ? `叙事参考:${narrative}。` : ''}引一句棋谚/棋理,用你的口吻:`
    } else if (stim.kind === 'phase_shift') {
      const pw = stim.phase === 'endgame' ? '残局' : stim.phase === 'midgame' ? '中盘' : '开局'
      user = `棋局进入${pw}。${len}。做个局势总评:盘面性质、谁占主动、双方战略方向;${narrative ? `参考走势:${narrative}。` : ''}引经据典,别流水账:`
    } else if (stim.kind === 'idle' || (stim.kind === 'topic_open' && !stim.moveZh)) {
      // 停顿深评:三选一轮换(rng 决定)——局势总评 / 历史回顾 / 展望预判
      const dim = this.deps.rng()
      const ictx = this.lastCtx.get(stim.gameId)
      const sit = ictx ? `眼下第${ictx.ply}手「${ictx.moveZh}」,${ictx.qual}` : '这局还在走'
      if (dim < 0.34) {
        user = `这会儿没新棋步。${len}。做个局势总评(${sit}):谁占优、局面性质、下一阶段该往哪使劲;${narrative ? `走势:${narrative}。` : ''}引经据典别空谈:`
      } else if (dim < 0.67 && narrative) {
        user = `这会儿没新棋步。${len}。回看这盘的走势(${narrative}):哪步是转折、当时的伏笔现在兑现没、棋手这盘的路子;用你的口吻带点掌故:`
      } else {
        user = `这会儿没新棋步。${len}。展望一下(${sit}):双方接下来的计划、有什么威胁或杀着苗头、该防哪一手;引一句棋理,别瞎猜:`
      }
    } else if (target && this.deps.rng() < c.reactProb) {
```

(即:保留原 `else if (target...)` 及其后分支不变,只把原 idle 分支替换为上面三分支轮换,并在其前插入 turning_point / phase_shift 两分支。)

- [ ] **Step 4: 运行确认通过**

Run: `cd server && npx vitest run src/chat/chat-engine.test.ts`
Expected: 多维度用例 PASS;把 Task 1 里 `it.skip` 的 turning_point 用例恢复为 `it` 并通过;既有用例不回归

- [ ] **Step 5: tsc + 提交**

Run: `cd server && npx tsc --noEmit`  (Expected: exit 0)

```bash
git add server/src/chat/chat-engine.ts server/src/chat/chat-engine.test.ts
git commit -m "feat(chat): 维度化点评——idle 轮换局势/回顾/展望 + turning_point/phase_shift 分支 + persona 偏好"
```

---

## Task 6: 端到端集成验证

**Files:** 无代码改动;跑真实 WS 一局观察多维度弹幕。

- [ ] **Step 1: 全量 tsc + 测试**

Run: `cd server && npx tsc --noEmit && npx vitest run`  (Expected: 全绿)
Run: `cd web && npx tsc --noEmit`                        (Expected: exit 0)

- [ ] **Step 2: 重启后端,WS 驱动一局(含一次大 swing)**

用 `scratchpad/ws-danmu-probe.mjs`(或临时脚本)开局、连走几步,并制造一次评分骤变(如故意弃子),grep 弹幕:应出现"转折/攻守易势"(turning_point)、停顿时出现"局势总评/回看这盘/展望"(idle 轮换)。

Expected: 弹幕呈现多层次(着法短评 + 转折点回顾 + 停顿深评),不再是清一色逐步点评。

- [ ] **Step 3: 提交(若有 probe 脚本留存)**

```bash
git add -A && git commit -m "chore: 叙事点评 e2e 验证脚本" || echo "无脚本改动"
```

---

## Self-Review

**1. Spec coverage(对照最优方案四层次):**
- 着法点评(微观)→ 既有 `move` 分支保留 ✓
- 局势总评(中观)→ `phase_shift` 分支 + idle 轮换第一维 ✓(Task 4/5)
- 历史回顾(叙事)→ `buildNarrative` + idle 轮换第二维 + turning_point 回顾 ✓(Task 3/4/5)
- 展望预判(前瞻)→ idle 轮换第三维 ✓(Task 5)
- 保留最近 2 步(放宽丢旧)→ Task 1 ✓
- persona 分工 → Task 5 system prompt 偏好 ✓
- 节奏编排(高频短评不滞后、停顿深评、关键点不丢)→ Task 1(高频窗口)+ Task 4(低频不丢)✓

**2. Placeholder scan:** Task 4 的测试驱动依赖 game-session.test 既有对局 harness(未逐字写全驱动)——这是唯一"接既有样板"处,已在任务里标注复用 line 142/170/207 的 `onStimulus` 捕获样板;其余步骤均含 complete code。

**3. Type consistency:** `ScoredMove { ply, scoreCp }` 在 narrative.ts 定义、chat-engine deps.repo 与 test 的 `getMoves` 返回一致;`GamesRepo.getMoves` 实际返回含更多字段(ply/side/move/fenAfter/scoreCp/byAi),结构上兼容 `ScoredMove`(TS 结构化子类型)。`StimulusKind` 新成员 `turning_point`/`phase_shift` 在 Task 2 定义、Task 4 生产、Task 5 消费,名称一致。

**取舍备注:** 历史回顾用"评分曲线+转折 ply"而非逐手中文着法复盘——省去 FEN 重放与 describeMoveZh 成本,v1 够用;若日后要"第8手弃的那个卒"这类具体子力回顾,再在 narrative 里接入 getMoves 的 move+describeMoveZh(独立增强,不影响本计划结构)。
