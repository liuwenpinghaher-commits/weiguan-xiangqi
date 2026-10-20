# M1 核心对弈闭环 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 做出"人能在浏览器里和 Pikafish 下完一整局中国象棋、AI 着法由导演控制器按陪练/拟人模式选出、整局自动存档并可复盘"的最小可运行闭环。

**Architecture:** npm workspaces 单仓双包:`server/`(Node + Fastify + ws + better-sqlite3,托管 Pikafish UCI 子进程、导演选着、SQLite 持久化、WebSocket 对局编排)与 `web/`(Vite + React + TS,棋盘交互 + 对局/复盘界面)。核心独特逻辑(UCI 解析、导演选着、持久化)用纯函数 + 依赖注入做成可测试单元;对外部象棋规则库/棋盘组件采用"先验证选型、再适配"的任务,不臆造其 API。

**Tech Stack:** Node 20+, TypeScript, Fastify, ws, better-sqlite3, Vitest, Vite, React;外部进程 Pikafish(UCI);前端象棋规则库与棋盘组件在 Task 4/Task 11 选型确定。

**约定:** 着法用 Pikafish 的坐标记法字符串(如 `h2e2`);引擎评分 `scoreCp` 一律为**当前走子方视角**的厘兵分,正数=走子方优。所有金额/分数与边界逻辑均带测试。

---

## 文件结构(决定任务拆分)

```
围观象棋/
├─ package.json                      # npm workspaces 根,统一脚本
├─ tsconfig.base.json
├─ server/
│  ├─ package.json
│  ├─ tsconfig.json
│  ├─ vitest.config.ts
│  └─ src/
│     ├─ engine/
│     │  ├─ uci-parse.ts            # 纯函数:解析 UCI info/bestmove(完整 TDD)
│     │  ├─ uci-parse.test.ts
│     │  ├─ engine.ts               # UciEngine:进程管理 + analyze()(注入 transport)
│     │  └─ engine.test.ts          # 用 FakeTransport 测
│     ├─ rules/
│     │  ├─ position.ts             # Position 接口 + 适配选定的象棋规则库
│     │  └─ position.test.ts
│     ├─ director/
│     │  ├─ director.ts             # selectMove 纯函数:陪练/拟人 + 防穿帮(完整 TDD)
│     │  └─ director.test.ts
│     ├─ store/
│     │  ├─ schema.sql              # games / moves 表
│     │  ├─ db.ts                   # 打开/迁移 SQLite
│     │  ├─ games-repo.ts           # 存档/读取(完整 TDD)
│     │  └─ games-repo.test.ts
│     ├─ session/
│     │  ├─ game-session.ts         # 编排:engine+director+repo 走一手(完整 TDD)
│     │  └─ game-session.test.ts
│     ├─ types.ts                   # 共享类型(EngineLine/DirectorContext 等)
│     ├─ ws-server.ts               # Fastify + ws 路由
│     └─ index.ts                   # 启动入口
└─ web/
   ├─ package.json
   ├─ tsconfig.json
   ├─ vite.config.ts
   └─ src/
      ├─ api/ws-client.ts           # 与后端 WS 通信
      ├─ board/Board.tsx            # 集成选定棋盘组件
      ├─ pages/PlayPage.tsx         # 对局页
      ├─ pages/ReviewPage.tsx       # 复盘页
      └─ main.tsx
```

---

## Task 0: 仓库脚手架(npm workspaces)

**Files:**
- Create: `package.json`, `tsconfig.base.json`, `.gitignore`, `server/package.json`, `server/tsconfig.json`, `server/vitest.config.ts`, `web/package.json`(Task 11 用,先占位最小)

- [ ] **Step 1: 初始化 git 与根 package.json**

Run:
```bash
cd "<repo-root>"
git init
```

Create `package.json`:
```json
{
  "name": "weiguan-xiangqi",
  "private": true,
  "workspaces": ["server", "web"],
  "scripts": {
    "test": "npm -w server run test",
    "dev:server": "npm -w server run dev",
    "dev:web": "npm -w web run dev"
  }
}
```

Create `.gitignore`:
```
node_modules
dist
*.sqlite
*.sqlite-journal
.env
engine/pikafish*
```

Create `tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  }
}
```

- [ ] **Step 2: server 包配置**

Create `server/package.json`:
```json
{
  "name": "server",
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsx watch src/index.ts"
  },
  "dependencies": {
    "fastify": "^4.28.0",
    "@fastify/websocket": "^10.0.1",
    "ws": "^8.18.0",
    "better-sqlite3": "^11.3.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.16.0",
    "vitest": "^2.0.0",
    "@types/node": "^20.14.0",
    "@types/better-sqlite3": "^7.6.0",
    "@types/ws": "^8.5.0"
  }
}
```

Create `server/tsconfig.json`:
```json
{
  "extends": "../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

Create `server/vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config'
export default defineConfig({ test: { environment: 'node' } })
```

Create minimal `web/package.json` (filled in Task 11):
```json
{ "name": "web", "private": true, "type": "module", "scripts": { "dev": "vite" } }
```

- [ ] **Step 3: 安装依赖**

Run: `cd "<repo-root>" && npm install`
Expected: 安装成功,生成 `package-lock.json` 与 `node_modules`。

- [ ] **Step 4: 冒烟测试 vitest 可跑**

Create `server/src/smoke.test.ts`:
```ts
import { test, expect } from 'vitest'
test('vitest works', () => { expect(1 + 1).toBe(2) })
```
Run: `npm -w server run test`
Expected: PASS(1 passed)。删除该文件:`rm server/src/smoke.test.ts`

- [ ] **Step 5: Commit**
```bash
git add -A
git commit -m "chore: scaffold npm workspaces (server + web)"
```

---

## Task 1: 共享类型

**Files:**
- Create: `server/src/types.ts`

- [ ] **Step 1: 写类型(无逻辑,无需测试)**

Create `server/src/types.ts`:
```ts
/** 引擎一条 MultiPV 候选着法,scoreCp 为走子方视角厘兵分 */
export interface EngineLine {
  multipv: number          // 第几候选(1=最优)
  move: string             // 坐标记法,如 "h2e2"
  scoreCp: number          // 厘兵分(走子方视角);若是杀棋则为 mate 映射的极值
  mate: number | null      // n 步杀(正=走子方杀),非杀为 null
  pv: string[]             // 主变着法序列
}

export type GameMode = 'coach' | 'humanlike'

/** 行为代理信号(M1 先放最小集,M2 扩展) */
export interface PlayerState {
  winStreak: number
  lossStreak: number
  lastMoveMs: number       // 上一手用时(毫秒),0 表示未知
}

export interface DirectorContext {
  mode: GameMode
  playerState: PlayerState
  /** 陪练:允许 AI 相对最优着的最大让分(厘兵),防穿帮硬上限 */
  maxDropCp: number
  /** 陪练:AI 目标评分带(走子方=AI 视角),AI 想停留的区间 */
  targetBand: { low: number; high: number }
  /** 拟人:目标强度档 0..1,1=最强;越低越爱挑次优着 */
  strength: number
  /** 注入随机源,范围 [0,1),测试时可固定 */
  rng: () => number
}

export interface DirectorDecision {
  move: string
  reason: string
  chosenLine: EngineLine
}
```

- [ ] **Step 2: Commit**
```bash
git add server/src/types.ts
git commit -m "feat: shared engine/director types"
```

---

## Task 2: UCI 输出解析(纯函数,完整 TDD)

**Files:**
- Create: `server/src/engine/uci-parse.ts`, `server/src/engine/uci-parse.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/engine/uci-parse.test.ts`:
```ts
import { test, expect } from 'vitest'
import { parseInfoLine, parseBestmove } from './uci-parse.js'

test('parseInfoLine 提取 multipv/score cp/pv', () => {
  const line = 'info depth 12 seldepth 18 multipv 2 score cp -34 nodes 100 pv h2e2 b9c7 i0h0'
  expect(parseInfoLine(line)).toEqual({
    multipv: 2, scoreCp: -34, mate: null, move: 'h2e2',
    pv: ['h2e2', 'b9c7', 'i0h0'],
  })
})

test('parseInfoLine 处理 mate 分数', () => {
  const line = 'info depth 20 multipv 1 score mate 3 pv b0c2 a9b7 c2d4'
  const r = parseInfoLine(line)!
  expect(r.mate).toBe(3)
  expect(r.scoreCp).toBeGreaterThan(29000) // mate 映射成极大正值
  expect(r.move).toBe('b0c2')
})

test('parseInfoLine 对没有 pv 的行返回 null', () => {
  expect(parseInfoLine('info depth 1 score cp 10 nodes 5')).toBeNull()
  expect(parseInfoLine('info string hashfull 0')).toBeNull()
})

test('parseBestmove 提取着法', () => {
  expect(parseBestmove('bestmove h2e2 ponder b9c7')).toBe('h2e2')
  expect(parseBestmove('bestmove (none)')).toBeNull()
  expect(parseBestmove('info depth 1')).toBeNull()
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm -w server run test -- uci-parse`
Expected: FAIL（找不到模块 / 函数未定义）

- [ ] **Step 3: 实现**

Create `server/src/engine/uci-parse.ts`:
```ts
import type { EngineLine } from '../types.js'

const MATE_BASE = 30000

/** 解析一行 `info ... multipv ... score ... pv ...`;非候选行返回 null */
export function parseInfoLine(line: string): EngineLine | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'info') return null
  const pvIdx = t.indexOf('pv')
  if (pvIdx === -1 || pvIdx === t.length - 1) return null

  const num = (key: string): number | null => {
    const i = t.indexOf(key)
    return i !== -1 && i + 1 < t.length ? Number(t[i + 1]) : null
  }

  const multipv = num('multipv') ?? 1
  const pv = t.slice(pvIdx + 1)

  let scoreCp = 0
  let mate: number | null = null
  const scoreIdx = t.indexOf('score')
  if (scoreIdx !== -1) {
    const kind = t[scoreIdx + 1]
    const val = Number(t[scoreIdx + 2])
    if (kind === 'mate') {
      mate = val
      scoreCp = val >= 0 ? MATE_BASE - val : -MATE_BASE - val
    } else if (kind === 'cp') {
      scoreCp = val
    }
  }
  return { multipv, move: pv[0], scoreCp, mate, pv }
}

/** 解析 `bestmove xxx`;无着法返回 null */
export function parseBestmove(line: string): string | null {
  const t = line.trim().split(/\s+/)
  if (t[0] !== 'bestmove') return null
  const m = t[1]
  return !m || m === '(none)' ? null : m
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm -w server run test -- uci-parse`
Expected: PASS(4 passed)

- [ ] **Step 5: Commit**
```bash
git add server/src/engine/uci-parse.ts server/src/engine/uci-parse.test.ts
git commit -m "feat: UCI info/bestmove parser with tests"
```

---

## Task 3: UciEngine 进程封装(注入 transport,可测)

**Files:**
- Create: `server/src/engine/engine.ts`, `server/src/engine/engine.test.ts`

设计:`UciEngine` 不直接依赖 `child_process`,而是依赖一个最小 `Transport` 接口(写命令 + 逐行回调)。生产用 spawn 实现,测试用 FakeTransport。

- [ ] **Step 1: 写失败测试**

Create `server/src/engine/engine.test.ts`:
```ts
import { test, expect } from 'vitest'
import { UciEngine, type Transport } from './engine.js'

/** 测试替身:记录写入的命令,可手动推送引擎输出行 */
class FakeTransport implements Transport {
  written: string[] = []
  private onLine: (l: string) => void = () => {}
  write(cmd: string) { this.written.push(cmd) }
  onData(cb: (l: string) => void) { this.onLine = cb }
  emit(line: string) { this.onLine(line) }
  close() {}
}

test('analyze 发送 position+go 并按 multipv 聚合候选,bestmove 收尾', async () => {
  const ft = new FakeTransport()
  const eng = new UciEngine(ft)
  const p = eng.analyze('startpos_fen_here', { multipv: 2, movetime: 100 })

  // 模拟引擎输出:同一 multipv 多次刷新只保留最后一次
  ft.emit('info depth 8 multipv 1 score cp 20 pv b0c2 a9b7')
  ft.emit('info depth 8 multipv 2 score cp -10 pv h2e2 i9h7')
  ft.emit('info depth 12 multipv 1 score cp 25 pv b0c2 a9b7 c3c4')
  ft.emit('bestmove b0c2')

  const lines = await p
  expect(ft.written).toContain('setoption name MultiPV value 2')
  expect(ft.written).toContain('position fen startpos_fen_here')
  expect(ft.written).toContain('go movetime 100')
  expect(lines).toHaveLength(2)
  expect(lines.find(l => l.multipv === 1)!.scoreCp).toBe(25) // 取最后一次刷新
  expect(lines[0].multipv).toBe(1) // 按 multipv 升序
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm -w server run test -- engine`
Expected: FAIL（模块不存在）

- [ ] **Step 3: 实现**

Create `server/src/engine/engine.ts`:
```ts
import { parseInfoLine, parseBestmove } from './uci-parse.js'
import type { EngineLine } from '../types.js'

export interface Transport {
  write(cmd: string): void
  onData(cb: (line: string) => void): void
  close(): void
}

export interface AnalyzeOpts { multipv: number; movetime?: number; depth?: number }

export class UciEngine {
  private latest = new Map<number, EngineLine>()
  private resolveFn: ((lines: EngineLine[]) => void) | null = null

  constructor(private transport: Transport) {
    this.transport.onData((line) => this.handle(line))
  }

  private handle(line: string) {
    const info = parseInfoLine(line)
    if (info) { this.latest.set(info.multipv, info); return }
    if (parseBestmove(line) !== null || line.startsWith('bestmove')) {
      const lines = [...this.latest.values()].sort((a, b) => a.multipv - b.multipv)
      this.resolveFn?.(lines)
      this.resolveFn = null
    }
  }

  analyze(fen: string, opts: AnalyzeOpts): Promise<EngineLine[]> {
    this.latest.clear()
    this.transport.write(`setoption name MultiPV value ${opts.multipv}`)
    this.transport.write(`position fen ${fen}`)
    const go = opts.movetime != null ? `go movetime ${opts.movetime}`
      : opts.depth != null ? `go depth ${opts.depth}` : 'go movetime 500'
    return new Promise((resolve) => {
      this.resolveFn = resolve
      this.transport.write(go)
    })
  }

  close() { this.transport.close() }
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm -w server run test -- engine`
Expected: PASS

- [ ] **Step 5: 加 spawn 版 Transport(生产用,薄封装,不单测)**

Append to `server/src/engine/engine.ts`:
```ts
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'

export function spawnTransport(binPath: string): Transport {
  const proc: ChildProcessWithoutNullStreams = spawn(binPath, [], { stdio: 'pipe' })
  const rl = createInterface({ input: proc.stdout })
  let onLine: (l: string) => void = () => {}
  rl.on('line', (l) => onLine(l))
  proc.stdin.write('uci\n')
  proc.stdin.write('isready\n')
  return {
    write: (cmd) => proc.stdin.write(cmd + '\n'),
    onData: (cb) => { onLine = cb },
    close: () => { proc.stdin.write('quit\n'); proc.kill() },
  }
}
```

- [ ] **Step 6: Commit**
```bash
git add server/src/engine/engine.ts server/src/engine/engine.test.ts
git commit -m "feat: UciEngine with injectable transport + spawn transport"
```

---

## Task 4: 象棋规则适配(选型验证 → 适配,先验证后写)

> **诚实前提:** 不臆造第三方库 API。本任务先 spike 选定一个可用的 JS 中国象棋规则库(候选关键词:`xiangqi.js` / `xiangqiground` / `js-xiangqi`),确认其"列合法着法 / 判将死 / FEN 进出"的真实 API,再写适配层 `Position`。若无合格库,则降级为"仅用 Pikafish 校验合法性"(见 Step 4)。

**Files:**
- Create: `server/src/rules/position.ts`, `server/src/rules/position.test.ts`

- [ ] **Step 1: Spike 选型**

Run: `npm view xiangqi.js version 2>/dev/null; npm view xiangqiground version 2>/dev/null; npm view js-xiangqi version 2>/dev/null`
动作:对返回存在的包,`npm -w server i <pkg>` 后在 node REPL 实测:能否从初始 FEN 列出红方合法着法、能否判断将死、FEN 格式是否与 Pikafish 兼容。把确认的 API 记到本任务下方注释里。
Expected:确定 1 个库及其确切函数签名;若全部不可用,转 Step 4 降级路径。

- [ ] **Step 2: 写适配层失败测试(以选定库的真实 API 为准填充)**

Create `server/src/rules/position.test.ts`:
```ts
import { test, expect } from 'vitest'
import { Position, START_FEN } from './position.js'

test('初始局面红先,合法着法非空且包含常见开局', () => {
  const pos = Position.fromFen(START_FEN)
  expect(pos.sideToMove()).toBe('red')
  const moves = pos.legalMoves()
  expect(moves.length).toBeGreaterThan(20)
  expect(moves).toContain('h2e2') // 炮二平五(坐标记法,以选定库实际为准)
})

test('走一手后轮到黑方,FEN 改变', () => {
  const pos = Position.fromFen(START_FEN)
  const next = pos.applyMove(pos.legalMoves()[0])
  expect(next.sideToMove()).toBe('black')
  expect(next.fen()).not.toBe(START_FEN)
})

test('非法着法被拒', () => {
  const pos = Position.fromFen(START_FEN)
  expect(() => pos.applyMove('a0a9')).toThrow()
})
```
> 注:若选定库的着法记法不是 `h2e2` 风格,这些断言要按真实记法改写,并在适配层内部做记法↔Pikafish 记法转换。

- [ ] **Step 3: 实现适配层(包裹选定库)**

Create `server/src/rules/position.ts`(骨架,内部调用选定库;以下为接口契约,实体按 Step 1 的库填充):
```ts
export type Side = 'red' | 'black'
export const START_FEN =
  'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

export class Position {
  private constructor(private readonly _fen: string) {}
  static fromFen(fen: string): Position { /* 验证 fen 合法,失败抛错 */ return new Position(fen) }
  fen(): string { return this._fen }
  sideToMove(): Side { return this._fen.split(' ')[1] === 'w' ? 'red' : 'black' }
  legalMoves(): string[] { /* 调用选定库返回 Pikafish 坐标记法数组 */ return [] }
  applyMove(move: string): Position { /* 校验 move ∈ legalMoves();非法抛 Error;返回新局面 */ return this }
  isGameOver(): { over: boolean; result?: 'red' | 'black' | 'draw' } { return { over: false } }
}
```

- [ ] **Step 4: 降级路径(仅当 Step 1 无合格库)**

若无库可用:`Position.legalMoves()` 通过对 Pikafish 发 `go perft 1` 解析叶子着法获得;`applyMove` 用 Pikafish 校验。把该实现写进 `position.ts`,测试改为标注 `// requires PIKAFISH_PATH` 并在缺二进制时 `test.skip`。在计划交付说明里记录此降级。

- [ ] **Step 5: 运行测试**

Run: `npm -w server run test -- position`
Expected: PASS(或在降级且无引擎时合理 skip)

- [ ] **Step 6: Commit**
```bash
git add server/src/rules/ server/package.json package-lock.json
git commit -m "feat: Position rules adapter (lib: <填实际库名>)"
```

---

## Task 5: 导演控制器 — 陪练模式 + 防穿帮(纯函数,完整 TDD)

**Files:**
- Create: `server/src/director/director.ts`, `server/src/director/director.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/director/director.test.ts`:
```ts
import { test, expect } from 'vitest'
import { selectMove } from './director.js'
import type { EngineLine, DirectorContext } from '../types.js'

const lines: EngineLine[] = [
  { multipv: 1, move: 'b0c2', scoreCp: 300, mate: null, pv: ['b0c2'] }, // 最优:大优
  { multipv: 2, move: 'h2e2', scoreCp: 40,  mate: null, pv: ['h2e2'] }, // 次优:小优(落在目标带)
  { multipv: 3, move: 'a0a1', scoreCp: -500, mate: null, pv: ['a0a1'] },// 臭着:大亏
]

const baseCoach: DirectorContext = {
  mode: 'coach',
  playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 },
  maxDropCp: 320,                 // 允许相对最优让最多 320
  targetBand: { low: -50, high: 80 }, // AI 想停在小优/均势
  strength: 0.5,
  rng: () => 0,
}

test('陪练:挑落在目标带内的着法,而非最优大优着', () => {
  const d = selectMove(lines, baseCoach)
  expect(d.move).toBe('h2e2')
})

test('防穿帮:绝不选让分超过 maxDropCp 的臭着', () => {
  // a0a1 相对最优(300)让了 800,超过 320,必须被排除
  const d = selectMove(lines, baseCoach)
  expect(d.move).not.toBe('a0a1')
})

test('防穿帮:若所有次优都超限,则回退到最优着(不送)', () => {
  const tight: DirectorContext = { ...baseCoach, maxDropCp: 50 }
  // 只有 b0c2(让0)在 50 以内,h2e2 让了 260 超限
  const d = selectMove(lines, tight)
  expect(d.move).toBe('b0c2')
})

test('连败:目标带自动下调(更让玩家),仍守防穿帮', () => {
  const losing: DirectorContext = { ...baseCoach, playerState: { winStreak: 0, lossStreak: 3, lastMoveMs: 0 } }
  const d = selectMove(lines, losing)
  // 连败时更偏向让玩家占优 → 选评分更低但未超限的 h2e2
  expect(d.move).toBe('h2e2')
  expect(d.reason).toMatch(/连败|让/)
})

test('杀棋例外:能将死时不放水,直接取杀', () => {
  const mateLines: EngineLine[] = [
    { multipv: 1, move: 'c3c4', scoreCp: 29997, mate: 3, pv: ['c3c4'] },
    { multipv: 2, move: 'h2e2', scoreCp: 30, mate: null, pv: ['h2e2'] },
  ]
  const d = selectMove(mateLines, baseCoach)
  expect(d.move).toBe('c3c4')
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm -w server run test -- director`
Expected: FAIL

- [ ] **Step 3: 实现陪练 + 防穿帮**

Create `server/src/director/director.ts`:
```ts
import type { EngineLine, DirectorContext, DirectorDecision } from '../types.js'

const MATE_THRESHOLD = 29000

export function selectMove(lines: EngineLine[], ctx: DirectorContext): DirectorDecision {
  if (lines.length === 0) throw new Error('no candidate moves')
  const sorted = [...lines].sort((a, b) => b.scoreCp - a.scoreCp)
  const best = sorted[0]

  // 杀棋例外:任何模式都不放过将死
  if (best.mate !== null && best.mate > 0) {
    return { move: best.move, reason: '抓住杀棋,不放水', chosenLine: best }
  }

  if (ctx.mode === 'coach') return selectCoach(sorted, best, ctx)
  return selectHumanlike(sorted, best, ctx)
}

function selectCoach(sorted: EngineLine[], best: EngineLine, ctx: DirectorContext): DirectorDecision {
  // 连败/连胜微调目标带:连败→整体下移(更让玩家);连胜→上移(加压)
  const shift = ctx.playerState.lossStreak * -20 + ctx.playerState.winStreak * 15
  const band = { low: ctx.targetBand.low + shift, high: ctx.targetBand.high + shift }

  // 防穿帮:候选必须满足 相对最优让分 <= maxDropCp
  const allowed = sorted.filter(l => best.scoreCp - l.scoreCp <= ctx.maxDropCp)
  const pool = allowed.length > 0 ? allowed : [best]

  // 在允许集中,选评分最接近目标带中心的着法
  const center = (band.low + band.high) / 2
  const inBand = pool.filter(l => l.scoreCp >= band.low && l.scoreCp <= band.high)
  const chosen = (inBand.length > 0 ? inBand : pool)
    .sort((a, b) => Math.abs(a.scoreCp - center) - Math.abs(b.scoreCp - center))[0]

  const reason = ctx.playerState.lossStreak >= 2
    ? '你最近连败,我稳一手让局面更胶着(未送子)'
    : '保持你跳一跳够得着的局势'
  return { move: chosen.move, reason, chosenLine: chosen }
}

function selectHumanlike(sorted: EngineLine[], best: EngineLine, ctx: DirectorContext): DirectorDecision {
  // 占位:Task 6 实现并补测;此处先回退最优,保证类型完整
  return { move: best.move, reason: '拟人(待实现)', chosenLine: best }
}

export { MATE_THRESHOLD }
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm -w server run test -- director`
Expected: PASS(5 passed)

- [ ] **Step 5: Commit**
```bash
git add server/src/director/
git commit -m "feat: director coach mode with anti-throw guard"
```

---

## Task 6: 导演控制器 — 拟人模式(强度采样,注入 rng)

**Files:**
- Modify: `server/src/director/director.ts`(`selectHumanlike`)
- Modify: `server/src/director/director.test.ts`(追加用例)

- [ ] **Step 1: 追加失败测试**

Append to `server/src/director/director.test.ts`:
```ts
const baseHuman: DirectorContext = {
  mode: 'humanlike',
  playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 },
  maxDropCp: 1000,
  targetBand: { low: 0, high: 0 },
  strength: 1,
  rng: () => 0,
}

test('拟人:strength=1 且 rng=0 取最优着', () => {
  const d = selectMove(lines, { ...baseHuman, strength: 1 })
  expect(d.move).toBe('b0c2')
})

test('拟人:strength 低 + rng 偏大时会挑次优着(更像人会失误)', () => {
  const d = selectMove(lines, { ...baseHuman, strength: 0.2, rng: () => 0.99 })
  expect(['h2e2', 'a0a1']).toContain(d.move)
  expect(d.move).not.toBe('b0c2')
})

test('拟人:同样守杀棋例外', () => {
  const mateLines: EngineLine[] = [
    { multipv: 1, move: 'c3c4', scoreCp: 29997, mate: 3, pv: ['c3c4'] },
    { multipv: 2, move: 'h2e2', scoreCp: 30, mate: null, pv: ['h2e2'] },
  ]
  expect(selectMove(mateLines, { ...baseHuman, strength: 0.1, rng: () => 0.99 }).move).toBe('c3c4')
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm -w server run test -- director`
Expected: FAIL(拟人占位返回恒为最优)

- [ ] **Step 3: 实现拟人采样**

Replace `selectHumanlike` in `server/src/director/director.ts`:
```ts
function selectHumanlike(sorted: EngineLine[], best: EngineLine, ctx: DirectorContext): DirectorDecision {
  // 权重:越靠前(越优)权重越高;strength 越高越集中于最优
  // w_i = exp(-rank_i * k),k 随 strength 增大而增大
  const k = 0.5 + ctx.strength * 4 // strength 0→k0.5(发散), 1→k4.5(集中)
  const weights = sorted.map((_, i) => Math.exp(-i * k))
  const total = weights.reduce((a, b) => a + b, 0)
  let r = ctx.rng() * total
  let idx = 0
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r < 0) { idx = i; break }
    idx = i
  }
  const chosen = sorted[idx]
  return {
    move: chosen.move,
    reason: idx === 0 ? '拟人:走我看到的最佳' : '拟人:换个我更顺手的下法',
    chosenLine: chosen,
  }
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm -w server run test -- director`
Expected: PASS(全部 director 用例)

- [ ] **Step 5: Commit**
```bash
git add server/src/director/
git commit -m "feat: director humanlike sampling with injected rng"
```

---

## Task 7: SQLite 存储 schema + 连接

**Files:**
- Create: `server/src/store/schema.sql`, `server/src/store/db.ts`, `server/src/store/db.test.ts`

- [ ] **Step 1: 写 schema(M1 只要 games/moves)**

Create `server/src/store/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  mode TEXT NOT NULL,                 -- coach | humanlike
  human_side TEXT NOT NULL,           -- red | black
  result TEXT,                        -- red | black | draw | null(进行中)
  start_fen TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS moves (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  game_id INTEGER NOT NULL REFERENCES games(id),
  ply INTEGER NOT NULL,               -- 第几手(从1)
  side TEXT NOT NULL,                 -- red | black
  move TEXT NOT NULL,                 -- 坐标记法
  fen_after TEXT NOT NULL,
  score_cp INTEGER,                   -- 走子方视角厘兵分(诊断用,M2 扩展)
  by_ai INTEGER NOT NULL DEFAULT 0    -- 1=AI 着,0=人着
);

CREATE INDEX IF NOT EXISTS idx_moves_game ON moves(game_id, ply);
```

- [ ] **Step 2: 写失败测试**

Create `server/src/store/db.test.ts`:
```ts
import { test, expect } from 'vitest'
import { openDb } from './db.js'

test('openDb(:memory:) 建表成功,可查到 games 表', () => {
  const db = openDb(':memory:')
  const row = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='games'"
  ).get()
  expect(row).toBeTruthy()
  db.close()
})
```

- [ ] **Step 3: 运行,确认失败**

Run: `npm -w server run test -- db`
Expected: FAIL

- [ ] **Step 4: 实现 db.ts**

Create `server/src/store/db.ts`:
```ts
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))

export type DB = Database.Database

export function openDb(path: string): DB {
  const db = new Database(path)
  db.pragma('journal_mode = WAL')
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8')
  db.exec(schema)
  return db
}
```

> 注:`schema.sql` 是非 .ts 资源。在 `server/vitest.config.ts` 与运行时均按相对 `import.meta.url` 读取,确保测试与生产一致;若构建后路径变化,在 build 脚本里把 `schema.sql` 拷到 `dist/store/`。

- [ ] **Step 5: 运行,确认通过**

Run: `npm -w server run test -- db`
Expected: PASS

- [ ] **Step 6: Commit**
```bash
git add server/src/store/schema.sql server/src/store/db.ts server/src/store/db.test.ts
git commit -m "feat: sqlite schema + openDb"
```

---

## Task 8: 对局存档仓库(完整 TDD)

**Files:**
- Create: `server/src/store/games-repo.ts`, `server/src/store/games-repo.test.ts`

- [ ] **Step 1: 写失败测试**

Create `server/src/store/games-repo.test.ts`:
```ts
import { test, expect } from 'vitest'
import { openDb } from './db.js'
import { GamesRepo } from './games-repo.js'

function repo() { return new GamesRepo(openDb(':memory:')) }

test('createGame 返回自增 id,getGame 能取回', () => {
  const r = repo()
  const id = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'FEN', startedAt: '2026-06-19T00:00:00Z' })
  expect(id).toBeGreaterThan(0)
  const g = r.getGame(id)!
  expect(g.mode).toBe('coach')
  expect(g.result).toBeNull()
})

test('addMove 递增 ply 并可按局取回有序着法', () => {
  const r = repo()
  const id = r.createGame({ mode: 'coach', humanSide: 'red', startFen: 'FEN', startedAt: 't' })
  r.addMove({ gameId: id, side: 'red', move: 'h2e2', fenAfter: 'F1', scoreCp: 20, byAi: false })
  r.addMove({ gameId: id, side: 'black', move: 'b9c7', fenAfter: 'F2', scoreCp: -15, byAi: true })
  const moves = r.getMoves(id)
  expect(moves.map(m => m.ply)).toEqual([1, 2])
  expect(moves[1].byAi).toBe(true)
  expect(moves[0].move).toBe('h2e2')
})

test('finishGame 写入结果与结束时间', () => {
  const r = repo()
  const id = r.createGame({ mode: 'humanlike', humanSide: 'black', startFen: 'FEN', startedAt: 't' })
  r.finishGame(id, 'red', '2026-06-19T01:00:00Z')
  const g = r.getGame(id)!
  expect(g.result).toBe('red')
  expect(g.endedAt).toBe('2026-06-19T01:00:00Z')
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm -w server run test -- games-repo`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `server/src/store/games-repo.ts`:
```ts
import type { DB } from './db.js'
import type { GameMode, Side } from '../types.js'

export interface GameRow {
  id: number; startedAt: string; endedAt: string | null
  mode: GameMode; humanSide: Side; result: Side | 'draw' | null; startFen: string
}
export interface MoveRow {
  id: number; gameId: number; ply: number; side: Side
  move: string; fenAfter: string; scoreCp: number | null; byAi: boolean
}

export class GamesRepo {
  constructor(private db: DB) {}

  createGame(g: { mode: GameMode; humanSide: Side; startFen: string; startedAt: string }): number {
    const info = this.db.prepare(
      'INSERT INTO games (started_at, mode, human_side, start_fen) VALUES (?,?,?,?)'
    ).run(g.startedAt, g.mode, g.humanSide, g.startFen)
    return Number(info.lastInsertRowid)
  }

  getGame(id: number): GameRow | null {
    const r: any = this.db.prepare('SELECT * FROM games WHERE id=?').get(id)
    if (!r) return null
    return { id: r.id, startedAt: r.started_at, endedAt: r.ended_at, mode: r.mode,
      humanSide: r.human_side, result: r.result, startFen: r.start_fen }
  }

  addMove(m: { gameId: number; side: Side; move: string; fenAfter: string; scoreCp: number | null; byAi: boolean }): number {
    const next: any = this.db.prepare('SELECT COALESCE(MAX(ply),0)+1 AS p FROM moves WHERE game_id=?').get(m.gameId)
    const info = this.db.prepare(
      'INSERT INTO moves (game_id, ply, side, move, fen_after, score_cp, by_ai) VALUES (?,?,?,?,?,?,?)'
    ).run(m.gameId, next.p, m.side, m.move, m.fenAfter, m.scoreCp, m.byAi ? 1 : 0)
    return Number(info.lastInsertRowid)
  }

  getMoves(gameId: number): MoveRow[] {
    const rows: any[] = this.db.prepare('SELECT * FROM moves WHERE game_id=? ORDER BY ply').all(gameId)
    return rows.map(r => ({ id: r.id, gameId: r.game_id, ply: r.ply, side: r.side,
      move: r.move, fenAfter: r.fen_after, scoreCp: r.score_cp, byAi: !!r.by_ai }))
  }

  finishGame(id: number, result: Side | 'draw', endedAt: string): void {
    this.db.prepare('UPDATE games SET result=?, ended_at=? WHERE id=?').run(result, endedAt, id)
  }
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm -w server run test -- games-repo`
Expected: PASS(3 passed)

- [ ] **Step 5: Commit**
```bash
git add server/src/store/games-repo.ts server/src/store/games-repo.test.ts
git commit -m "feat: games/moves repository with tests"
```

---

## Task 9: 对局编排服务(engine+director+rules+repo,完整 TDD)

**Files:**
- Create: `server/src/session/game-session.ts`, `server/src/session/game-session.test.ts`

设计:`GameSession` 依赖注入 `engine`(只需 `analyze`)、`director`(`selectMove`)、`position`(规则)、`repo`、`clock`(返回 ISO 时间,可注入)。`playHumanMove` 落人着、判定、若未结束则 `playAiMove`。

- [ ] **Step 1: 写失败测试(用 Fake 引擎/规则)**

Create `server/src/session/game-session.test.ts`:
```ts
import { test, expect, vi } from 'vitest'
import { openDb } from '../store/db.js'
import { GamesRepo } from '../store/games-repo.js'
import { GameSession } from './game-session.js'
import type { EngineLine } from '../types.js'

// Fake 规则:着法即字符串,走两手就结束(便于测编排)
function fakePosition(fen: string) {
  return {
    fen: () => fen,
    sideToMove: () => (fen.includes(' w ') ? 'red' : 'black') as 'red' | 'black',
    legalMoves: () => ['h2e2', 'b0c2'],
    applyMove: (m: string) => fakePosition(fen.includes(' w ') ? fen.replace(' w ', ' b ') : fen.replace(' b ', ' w ')),
    isGameOver: () => ({ over: false as const }),
  }
}
const fakeEngine = { analyze: vi.fn(async (): Promise<EngineLine[]> => [
  { multipv: 1, move: 'b0c2', scoreCp: 20, mate: null, pv: ['b0c2'] },
]) }

test('playHumanMove 落人着并触发 AI 回着,均入库且 ply 连续', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  let t = 0
  const session = new GameSession({
    repo, engine: fakeEngine as any,
    makePosition: fakePosition as any,
    clock: () => `t${t++}`,
  })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })

  const res = await session.playHumanMove(gameId, 'h2e2')
  expect(res.aiMove).toBe('b0c2')
  const moves = repo.getMoves(gameId)
  expect(moves.map(m => m.ply)).toEqual([1, 2])
  expect(moves[0].byAi).toBe(false)
  expect(moves[1].byAi).toBe(true)
})

test('非法人着被拒,不入库', async () => {
  const repo = new GamesRepo(openDb(':memory:'))
  const session = new GameSession({ repo, engine: fakeEngine as any, makePosition: fakePosition as any, clock: () => 't' })
  const gameId = session.newGame({ mode: 'coach', humanSide: 'red', startFen: 'START w - - 0 1' })
  await expect(session.playHumanMove(gameId, 'z9z9')).rejects.toThrow()
  expect(repo.getMoves(gameId)).toHaveLength(0)
})
```

- [ ] **Step 2: 运行,确认失败**

Run: `npm -w server run test -- game-session`
Expected: FAIL

- [ ] **Step 3: 实现**

Create `server/src/session/game-session.ts`:
```ts
import type { GamesRepo } from '../store/games-repo.js'
import type { EngineLine, GameMode, Side, DirectorContext } from '../types.js'
import { selectMove } from '../director/director.js'

interface PositionLike {
  fen(): string
  sideToMove(): Side
  legalMoves(): string[]
  applyMove(move: string): PositionLike
  isGameOver(): { over: boolean; result?: Side | 'draw' }
}
interface EngineLike { analyze(fen: string, opts: { multipv: number; movetime?: number }): Promise<EngineLine[]> }

export interface GameSessionDeps {
  repo: GamesRepo
  engine: EngineLike
  makePosition: (fen: string) => PositionLike
  clock: () => string
}

const MULTIPV = 5

export class GameSession {
  private positions = new Map<number, PositionLike>()
  private modes = new Map<number, GameMode>()
  constructor(private deps: GameSessionDeps) {}

  newGame(g: { mode: GameMode; humanSide: Side; startFen: string }): number {
    const id = this.deps.repo.createGame({ ...g, startedAt: this.deps.clock() })
    this.positions.set(id, this.deps.makePosition(g.startFen))
    this.modes.set(id, g.mode)
    return id
  }

  async playHumanMove(gameId: number, move: string): Promise<{ aiMove: string | null; fen: string; over: boolean }> {
    const pos = this.positions.get(gameId)
    if (!pos) throw new Error('game not found')
    if (!pos.legalMoves().includes(move)) throw new Error(`illegal move: ${move}`)

    const after = pos.applyMove(move)
    this.deps.repo.addMove({ gameId, side: pos.sideToMove(), move, fenAfter: after.fen(), scoreCp: null, byAi: false })
    this.positions.set(gameId, after)

    let over = after.isGameOver()
    if (over.over) { this.finish(gameId, over.result!); return { aiMove: null, fen: after.fen(), over: true } }

    const aiMove = await this.playAiMove(gameId)
    const cur = this.positions.get(gameId)!
    over = cur.isGameOver()
    if (over.over) this.finish(gameId, over.result!)
    return { aiMove, fen: cur.fen(), over: over.over }
  }

  private async playAiMove(gameId: number): Promise<string> {
    const pos = this.positions.get(gameId)!
    const lines = await this.deps.engine.analyze(pos.fen(), { multipv: MULTIPV, movetime: 500 })
    const ctx = this.buildContext(gameId)
    const decision = selectMove(lines, ctx)
    const after = pos.applyMove(decision.move)
    this.deps.repo.addMove({ gameId, side: pos.sideToMove(), move: decision.move, fenAfter: after.fen(), scoreCp: decision.chosenLine.scoreCp, byAi: true })
    this.positions.set(gameId, after)
    return decision.move
  }

  private buildContext(gameId: number): DirectorContext {
    const mode = this.modes.get(gameId)!
    return {
      mode,
      playerState: { winStreak: 0, lossStreak: 0, lastMoveMs: 0 }, // M2 接行为信号
      maxDropCp: 320,
      targetBand: { low: -50, high: 80 },
      strength: 0.6,
      rng: Math.random,
    }
  }

  private finish(gameId: number, result: Side | 'draw') {
    this.deps.repo.finishGame(gameId, result, this.deps.clock())
  }
}
```

- [ ] **Step 4: 运行,确认通过**

Run: `npm -w server run test -- game-session`
Expected: PASS

- [ ] **Step 5: Commit**
```bash
git add server/src/session/
git commit -m "feat: GameSession orchestration (human move -> ai reply)"
```

---

## Task 10: WebSocket 服务 + 启动入口

**Files:**
- Create: `server/src/ws-server.ts`, `server/src/index.ts`

> 真实集成:需要 Pikafish 二进制。用环境变量 `PIKAFISH_PATH` 指定;缺失时启动报清晰错误。本任务手动验收(非单测),协议保持极简 JSON。

- [ ] **Step 1: 写 WS 路由**

Create `server/src/ws-server.ts`:
```ts
import Fastify from 'fastify'
import websocket from '@fastify/websocket'
import { openDb } from './store/db.js'
import { GamesRepo } from './store/games-repo.js'
import { GameSession } from './session/game-session.js'
import { UciEngine, spawnTransport } from './engine/engine.js'
import { Position } from './rules/position.js'

export async function buildServer(opts: { dbPath: string; enginePath: string }) {
  const app = Fastify()
  await app.register(websocket)

  const repo = new GamesRepo(openDb(opts.dbPath))
  const engine = new UciEngine(spawnTransport(opts.enginePath))
  const session = new GameSession({
    repo, engine,
    makePosition: (fen) => Position.fromFen(fen) as any,
    clock: () => new Date().toISOString(),
  })

  app.get('/play', { websocket: true }, (conn) => {
    conn.socket.on('message', async (raw) => {
      try {
        const msg = JSON.parse(raw.toString())
        if (msg.type === 'new') {
          const id = session.newGame({ mode: msg.mode, humanSide: msg.humanSide, startFen: msg.startFen })
          conn.socket.send(JSON.stringify({ type: 'started', gameId: id }))
        } else if (msg.type === 'move') {
          const r = await session.playHumanMove(msg.gameId, msg.move)
          conn.socket.send(JSON.stringify({ type: 'update', ...r }))
        }
      } catch (e: any) {
        conn.socket.send(JSON.stringify({ type: 'error', message: e.message }))
      }
    })
  })

  return app
}
```

Create `server/src/index.ts`:
```ts
import { buildServer } from './ws-server.js'

const enginePath = process.env.PIKAFISH_PATH
if (!enginePath) { console.error('请设置 PIKAFISH_PATH 指向 Pikafish 可执行文件'); process.exit(1) }

const app = await buildServer({ dbPath: process.env.DB_PATH ?? './weiguan.sqlite', enginePath })
await app.listen({ port: 8787 })
console.log('server on ws://localhost:8787/play')
```

- [ ] **Step 2: 手动验收(需 Pikafish)**

下载 Pikafish 二进制 + NNUE 权重(实现期核对许可证与平台二进制),置于 `engine/`。
Run: `PIKAFISH_PATH=./engine/pikafish npm -w server run dev`
用 `websocat ws://localhost:8787/play` 或临时脚本发送:
`{"type":"new","mode":"coach","humanSide":"red","startFen":"<START_FEN>"}` → 期望收到 `started`;
`{"type":"move","gameId":1,"move":"h2e2"}` → 期望收到 `update` 且含 `aiMove`。
Expected:能完成"人走一手 → AI 回一手"的往返;DB 文件出现两条 moves。

- [ ] **Step 3: Commit**
```bash
git add server/src/ws-server.ts server/src/index.ts
git commit -m "feat: websocket server + entrypoint (manual-verified with Pikafish)"
```

---

## Task 11: 前端 — 棋盘集成 + 对局页(选型验证 → 集成)

> **诚实前提:** 棋盘组件 API 需先验证。Spike 候选:`react-xiangqiboard` / 基于 `chessground` 的象棋适配 / 纯 SVG 自绘。本任务先确认渲染与"点击/拖拽产生着法"的真实 API,再写 `Board.tsx`。

**Files:**
- Create/Modify: `web/package.json`, `web/vite.config.ts`, `web/tsconfig.json`, `web/index.html`, `web/src/main.tsx`, `web/src/api/ws-client.ts`, `web/src/board/Board.tsx`, `web/src/pages/PlayPage.tsx`

- [ ] **Step 1: Vite+React 脚手架**

填充 `web/package.json`:
```json
{
  "name": "web", "private": true, "type": "module",
  "scripts": { "dev": "vite", "build": "vite build", "preview": "vite preview" },
  "dependencies": { "react": "^18.3.0", "react-dom": "^18.3.0" },
  "devDependencies": { "vite": "^5.3.0", "@vitejs/plugin-react": "^4.3.0", "typescript": "^5.5.0", "@types/react": "^18.3.0", "@types/react-dom": "^18.3.0" }
}
```
Create `web/vite.config.ts`:
```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
export default defineConfig({ plugins: [react()], server: { port: 5173 } })
```
Create `web/tsconfig.json`:
```json
{ "extends": "../tsconfig.base.json", "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM"], "types": [] }, "include": ["src"] }
```
Create `web/index.html`:
```html
<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>围观象棋</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>
```
Run: `cd "<repo-root>" && npm install`

- [ ] **Step 2: Spike 棋盘组件**

Run: `npm view react-xiangqiboard version 2>/dev/null; npm view chessground version 2>/dev/null`
动作:选定一个,确认"传入局面 + 注册落子回调(from→to 或着法字符串)"的真实 API,记到 `Board.tsx` 顶部注释。

- [ ] **Step 3: WS 客户端**

Create `web/src/api/ws-client.ts`:
```ts
export type ServerMsg =
  | { type: 'started'; gameId: number }
  | { type: 'update'; aiMove: string | null; fen: string; over: boolean }
  | { type: 'error'; message: string }

export function connect(onMsg: (m: ServerMsg) => void): { send: (m: object) => void; close: () => void } {
  const ws = new WebSocket('ws://localhost:8787/play')
  ws.onmessage = (e) => onMsg(JSON.parse(e.data))
  return {
    send: (m) => ws.readyState === 1 ? ws.send(JSON.stringify(m)) : ws.addEventListener('open', () => ws.send(JSON.stringify(m)), { once: true }),
    close: () => ws.close(),
  }
}
```

- [ ] **Step 4: Board 组件(按选定库 API 填充渲染)**

Create `web/src/board/Board.tsx`:
```tsx
// 选定棋盘库:<填库名与确认的 API>
import { useEffect, useRef } from 'react'

export function Board(props: { fen: string; onMove: (move: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 用选定库在 ref.current 渲染 props.fen,并把用户落子转成 Pikafish 坐标记法后调用 props.onMove
    // 实体代码按 Step 2 确认的 API 填充
  }, [props.fen])
  return <div ref={ref} aria-label="棋盘" />
}
```

- [ ] **Step 5: 对局页 + 入口**

Create `web/src/pages/PlayPage.tsx`:
```tsx
import { useEffect, useRef, useState } from 'react'
import { connect, type ServerMsg } from '../api/ws-client.js'
import { Board } from '../board/Board.js'

const START_FEN = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

export function PlayPage() {
  const [fen, setFen] = useState(START_FEN)
  const [gameId, setGameId] = useState<number | null>(null)
  const [status, setStatus] = useState('连接中…')
  const conn = useRef<ReturnType<typeof connect> | null>(null)

  useEffect(() => {
    const c = connect((m: ServerMsg) => {
      if (m.type === 'started') { setGameId(m.gameId); setStatus('开局,红先') }
      else if (m.type === 'update') { setFen(m.fen); setStatus(m.over ? '本局结束' : `AI 走了 ${m.aiMove ?? ''}`) }
      else if (m.type === 'error') setStatus('错误:' + m.message)
    })
    conn.current = c
    c.send({ type: 'new', mode: 'coach', humanSide: 'red', startFen: START_FEN })
    return () => c.close()
  }, [])

  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <h1>围观象棋 · 陪练</h1>
      <p>{status}</p>
      <Board fen={fen} onMove={(move) => gameId != null && conn.current?.send({ type: 'move', gameId, move })} />
    </div>
  )
}
```
Create `web/src/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client'
import { PlayPage } from './pages/PlayPage.js'
createRoot(document.getElementById('root')!).render(<PlayPage />)
```

- [ ] **Step 6: 手动验收**

Run(两个终端):`PIKAFISH_PATH=./engine/pikafish npm run dev:server` 与 `npm run dev:web`
打开 `http://localhost:5173`,在棋盘上走一手 → 看到 AI 回着、局面更新、状态栏提示。
Expected:可在浏览器里和 AI 走完若干回合。

- [ ] **Step 7: Commit**
```bash
git add web/
git commit -m "feat: web board + play page wired to ws (board lib: <填实际库名>)"
```

---

## Task 12: 复盘页(读取存档逐步回放)

**Files:**
- Create: `server/src/ws-server.ts`(加一个 HTTP 路由 `/games/:id`)、`web/src/pages/ReviewPage.tsx`

- [ ] **Step 1: 后端加只读查询路由**

Modify `server/src/ws-server.ts`,在 `return app` 前加:
```ts
  app.get('/games/:id', async (req: any) => {
    const id = Number(req.params.id)
    const game = repo.getGame(id)
    if (!game) return { error: 'not found' }
    return { game, moves: repo.getMoves(id) }
  })
```

- [ ] **Step 2: 复盘页**

Create `web/src/pages/ReviewPage.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { Board } from '../board/Board.js'

interface MoveRow { ply: number; move: string; fenAfter: string; byAi: boolean; scoreCp: number | null }

export function ReviewPage(props: { gameId: number }) {
  const [moves, setMoves] = useState<MoveRow[]>([])
  const [startFen, setStartFen] = useState('')
  const [idx, setIdx] = useState(0) // 0=开局,k=第k手后

  useEffect(() => {
    fetch(`http://localhost:8787/games/${props.gameId}`).then(r => r.json()).then(d => {
      setMoves(d.moves); setStartFen(d.game.startFen)
    })
  }, [props.gameId])

  const fen = idx === 0 ? startFen : moves[idx - 1]?.fenAfter ?? startFen
  return (
    <div style={{ maxWidth: 560, margin: '0 auto', padding: 16 }}>
      <h1>复盘 · 第 {props.gameId} 局</h1>
      <Board fen={fen} onMove={() => {}} />
      <div style={{ marginTop: 12 }}>
        <button onClick={() => setIdx(i => Math.max(0, i - 1))} disabled={idx === 0}>上一手</button>
        <span style={{ margin: '0 12px' }}>{idx} / {moves.length}</span>
        <button onClick={() => setIdx(i => Math.min(moves.length, i + 1))} disabled={idx === moves.length}>下一手</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 3: 手动验收**

下完一局后,临时把入口渲染 `<ReviewPage gameId={1} />`,验证可前后逐步回放、局面正确。

- [ ] **Step 4: Commit**
```bash
git add server/src/ws-server.ts web/src/pages/ReviewPage.tsx
git commit -m "feat: review page replays saved game step by step"
```

---

## Task 13: 收尾 — 全量测试 + 文档

**Files:**
- Create: `README.md`

- [ ] **Step 1: 跑全量后端测试**

Run: `npm -w server run test`
Expected: 全绿(uci-parse / engine / director / db / games-repo / game-session;position 视选型而定)。

- [ ] **Step 2: 写 README(运行说明)**

Create `README.md`,包含:依赖安装、`PIKAFISH_PATH` 配置与引擎/权重下载与许可证说明、`npm run dev:server` + `npm run dev:web`、已知降级项(若 Task 4 走了降级路径)、M2/M3 待补。

- [ ] **Step 3: Commit**
```bash
git add README.md
git commit -m "docs: M1 readme and run instructions"
```

---

## 验收标准(M1 完成定义)

- 浏览器里能与 Pikafish 下完一整局,AI 着法由导演控制器按陪练/拟人模式选出。
- 导演陪练模式有**防穿帮**保证:相对最优让分不超过 `maxDropCp`、能将死必取杀(已被测试覆盖)。
- 每局自动存档,复盘页可逐步回放。
- 后端核心逻辑(UCI 解析、导演选着、持久化、对局编排)有通过的单元测试。
- 外部库选型(规则库 / 棋盘组件)已确认真实 API 并在代码注释/README 记录;任何降级项已写明。

## 留给 M2 / M3 的接口预留

- `moves.score_cp` 字段已存,M2 诊断直接用。
- `GameSession.buildContext` 的 `playerState` 已是注入点,M2 接行为信号。
- `director.ts` 的 `selectMove` 已可独立扩展更多风格档(M3 拟人棋风)。
- 存储层 `openDb` 集中迁移,M3 加 `persona_memory` 等表只需扩 `schema.sql`。
