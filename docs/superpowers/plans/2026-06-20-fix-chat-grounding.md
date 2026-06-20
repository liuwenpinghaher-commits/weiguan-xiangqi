# 修复:弹幕"没意义+反复重复"+ 心理未接 + 记忆自指 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`). 这是对真实设计缺陷的系统修复,严格 TDD:先补能抓住缺陷的测试,再改实现。

**Goal:** 让观棋者弹幕**扣住真实棋局**(不再"雾里看花")、**不再自我重复**、**长期记忆记的是玩家而非角色自己的话**,并把**导演的心理信号真正接通**。

**根因(已用运行中系统取证):**
1. 弹幕 prompt 无任何真实棋局信息(只有 `kind:move`+带噪数字)→ 角色集体"看不懂"。
2. 角色把自己说过的话当"玩家记忆"回灌 → 逐字重复;且 DB 里 0 条 fact/insight。
3. `game-session.buildContext` 的 `playerState` 写死 0 → "动态控盘/心理"从不生效。
4. 92 测试只测机制、不测内容质量 → 虚假绿。

**Tech Stack:** 复用现有(server: Node ESM+TS+Vitest)。新增纯函数 `describe-move.ts`(库无关,FEN+坐标解析,中文记谱)。

---

## Task 1: 中文着法描述器(纯函数,完整 TDD)

**Files:** Create `server/src/rules/describe-move.ts`、`server/src/rules/describe-move.test.ts`

> 库无关:只解析标准象棋 FEN + Pikafish 坐标记法(rank0=红底)。产出"炮二平五/马2进3/兵九进一"。已知简化:不做 前/后 同子消歧、不标"将军"(v1 够用,后续可加)。

- [ ] **Step 1: 写失败测试**

Create `server/src/rules/describe-move.test.ts`:
```ts
import { test, expect } from 'vitest'
import { describeMoveZh } from './describe-move.js'

const START = 'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1'

test('红炮平中:h2e2 → 炮二平五', () => {
  expect(describeMoveZh(START, 'h2e2')).toBe('红炮二平五')
})

test('红兵进一:a3a4 → 兵九进一', () => {
  expect(describeMoveZh(START, 'a3a4')).toBe('红兵九进一')
})

test('黑马跳:b9c7 → 马2进3(黑用阿拉伯数字、进为向下)', () => {
  expect(describeMoveZh(START, 'b9c7')).toBe('黑马2进3')
})

test('红马跳:b0c2 → 马八进七', () => {
  expect(describeMoveZh(START, 'b0c2')).toBe('红马八进七')
})

test('吃子标注:构造红炮吃黑卒的局面', () => {
  // 红炮 e2,黑卒 e7;炮 e2→e7 吃卒(纵向直走,炮二路…用中路五):红炮 e 在中路=五,进
  const fen = 'rnbakabnr/9/9/4p4/9/9/9/4C4/9/RNBAKABNR w - - 0 1'
  const d = describeMoveZh(fen, 'e2e7')
  expect(d).toContain('炮五进')
  expect(d).toContain('吃')
})

test('非法格式抛错', () => {
  expect(() => describeMoveZh(START, 'zz')).toThrow()
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm -w server run test -- describe-move` → FAIL

- [ ] **Step 3: 实现**

Create `server/src/rules/describe-move.ts`:
```ts
// 库无关:解析标准象棋 FEN(行 top→bottom = rank 9→0)+ Pikafish 坐标(file a-i, rank 0-9,rank0=红底)
// 产出中文纵线记谱:红用 一二三四五六七八九(从红方右到左),黑用阿拉伯数字(从黑方左到右)
const RED_PIECE: Record<string, string> = { R: '车', N: '马', B: '相', A: '仕', K: '帅', C: '炮', P: '兵' }
const BLACK_PIECE: Record<string, string> = { r: '车', n: '马', b: '象', a: '士', k: '将', c: '炮', p: '卒' }
const CN_NUM = ['一', '二', '三', '四', '五', '六', '七', '八', '九']
const DIAGONAL = new Set(['N', 'B', 'A']) // 马/相(象)/士 用"目标路",其余用步数

/** 解析 FEN 棋盘到 [rank][file] 的 piece char('' = 空)。rank 0=红底, file 0=a */
function parseBoard(fen: string): string[][] {
  const rows = fen.split(' ')[0].split('/')
  if (rows.length !== 10) throw new Error(`bad FEN: ${fen}`)
  // rows[0] = 顶部 = rank 9; rows[9] = 底部 = rank 0
  const board: string[][] = Array.from({ length: 10 }, () => Array(9).fill(''))
  for (let r = 0; r < 10; r++) {
    const rank = 9 - r
    let file = 0
    for (const ch of rows[r]) {
      if (/[1-9]/.test(ch)) file += parseInt(ch)
      else { board[rank][file] = ch; file++ }
    }
  }
  return board
}

function pieceAt(board: string[][], file: number, rank: number): string {
  return board[rank]?.[file] ?? ''
}

/** Pikafish 坐标如 "h2e2" → {f1,r1,f2,r2}(file 0-8, rank 0-9) */
function parseMove(move: string): { f1: number; r1: number; f2: number; r2: number } {
  const m = move.match(/^([a-i])([0-9])([a-i])([0-9])$/)
  if (!m) throw new Error(`bad move: ${move}`)
  const fi = (c: string) => c.charCodeAt(0) - 97
  return { f1: fi(m[1]), r1: +m[2], f2: fi(m[3]), r2: +m[4] }
}

/** 某方某 file 的"路"号:红=9-file(写中文),黑=file+1(写阿拉伯) */
function laneStr(file: number, red: boolean): string {
  return red ? CN_NUM[9 - file - 1] : String(file + 1)
}
function stepStr(n: number, red: boolean): string {
  return red ? CN_NUM[n - 1] : String(n)
}

/**
 * 把一步棋(走子前 FEN + Pikafish 记法)描述成中文,如 "红炮二平五"、"黑马2进3"、"红炮五进五(吃卒)"
 */
export function describeMoveZh(fenBefore: string, move: string): string {
  const { f1, r1, f2, r2 } = parseMove(move)
  const board = parseBoard(fenBefore)
  const ch = pieceAt(board, f1, r1)
  if (!ch) throw new Error(`no piece at from-square of ${move}`)
  const red = ch === ch.toUpperCase()
  const pieceZh = red ? RED_PIECE[ch.toUpperCase()] : BLACK_PIECE[ch.toLowerCase()]
  const sideZh = red ? '红' : '黑'
  const fromLane = laneStr(f1, red)

  let action: string
  if (r1 === r2) {
    action = `平${laneStr(f2, red)}`           // 横走
  } else {
    // 红进=rank 增大;黑进=rank 减小
    const forward = red ? r2 > r1 : r2 < r1
    const dir = forward ? '进' : '退'
    const val = DIAGONAL.has(ch.toUpperCase())
      ? laneStr(f2, red)                        // 斜行子:写目标路
      : stepStr(Math.abs(r2 - r1), red)         // 直行子:写步数
    action = `${dir}${val}`
  }

  const captured = pieceAt(board, f2, r2)
  const capturedZh = captured
    ? (captured === captured.toUpperCase() ? RED_PIECE[captured] : BLACK_PIECE[captured])
    : ''
  const capStr = capturedZh ? `(吃${capturedZh})` : ''

  return `${sideZh}${pieceZh}${fromLane}${action}${capStr}`
}
```

- [ ] **Step 4: 运行确认通过 + tsc + commit**

Run: `npm -w server run test -- describe-move`(全绿)、`npx tsc --noEmit -p server/tsconfig.json`。
```bash
git add server/src/rules/describe-move.ts server/src/rules/describe-move.test.ts
git commit -m "feat(fix): Chinese move describer (grounds chat in the real move)"
```

---

## Task 2: 给 Stimulus 注入真实棋局 + 重写弹幕 prompt(TDD)

**Files:** 改 `server/src/types.ts`、`server/src/session/game-session.ts`、`server/src/chat/chat-engine.ts`、`server/src/chat/chat-engine.test.ts`

- [ ] **Step 1: 扩展 Stimulus 类型**(`server/src/types.ts` 改 `Stimulus`)
```ts
export interface Stimulus {
  kind: StimulusKind
  gameId: number
  scoreCp: number | null      // 真实评分(走子方视角);噪声由 engine-view 按角色加
  moveZh?: string             // 中文着法,如 "红炮二平五(吃卒)"
  side?: Side                 // 这步是谁走的
  ply?: number                // 第几手
  phase?: 'opening' | 'midgame' | 'endgame'
  humanText?: string
  tension: number
}
```

- [ ] **Step 2: game-session 计算并注入真实内容**
改 `game-session.ts` `playHumanMove`:
- 用 `describeMoveZh(beforeFen, move)` 算人着/AI 着的 `moveZh`(beforeFen = 走这步前的 `pos.fen()`)。import describeMoveZh。
- 维护每局手数 `ply`(用 repo.getMoves(gameId).length 或自增计数),`phase` 用 `ply<=16?opening:(子力少?endgame:midgame)`——简化:`ply<=16?'opening':ply<=60?'midgame':'endgame'`。
- onStimulus 带上 `moveZh, side, ply, phase`,**人着也带真实 scoreCp**:人着后对 `afterHuman.fen()` 不必再调引擎(省一次),可传 `scoreCp: -decision...`?——简化:人着 `scoreCp` 仍可为 null 但**必带 moveZh**(让角色至少看见走了啥);AI 着带真实 `aiCp`。
- **tension 调整**:人着默认 0.55(略高于阈值,保证"你走一步常有人接"),AI 着 `max(0.5, |aiCp|/300)`,关键事件(吃子:moveZh 含"吃")tension 提到 0.9。

- [ ] **Step 3: chat-engine 重写 buildPrompt 用真实内容 + 加去重护栏**
改 `chat-engine.ts`:
- `buildPrompt`:user 段改为(move 类):`第${ply}手(${phase}):${moveZh}。当前${qualeval}。用你的水平和脾气,针对这步说一句(≤25字),可抛棋招/调侃/拉踩,别空泛说"看不懂":`,其中 `qualeval` 由真实 `scoreCp`(经 viewScore 加噪)映射为中文:`>200 大优 / 80~200 占优 / -80~80 大致均势 / -200~-80 稍亏 / <-200 大亏`(走子方视角→换算成"红/黑"优)。human_said 段保留。
- **grounding 记忆改用 fact/insight**(见 Task 3),不再注入自己的 episode。
- **去重护栏**:发前比对该 persona 最近 1 条 emit 的文本,若高度相似(去标点后相等或一方包含另一方)则**跳过本条**(防逐字/近似重复)。维护 `lastTextByPersona: Map`。

- [ ] **Step 4: chat-engine 测试(TDD,先红)**——追加:
  - 「prompt 含真实着法」:给 stim 带 `moveZh:'红炮二平五'`,用 FakeLLM 捕获 messages,断言 system+user 里出现 `红炮二平五`。
  - 「去重护栏」:FakeLLM 连续两次返回同一句,断言第二次**不 emit**。
  - 保留并通过原有用例(注意原用例可能需补 moveZh 字段)。

- [ ] **Step 5: tsc + 全套测试 + commit**
```bash
npx tsc --noEmit -p server/tsconfig.json && npm -w server run test
git add server/src/types.ts server/src/session/ server/src/chat/
git commit -m "fix(chat): ground prompt in real move + qualitative eval + dedup guard"
```

---

## Task 3: 记忆改为"关于玩家",反思吃真实棋局(TDD)

**Files:** 改 `server/src/chat/chat-engine.ts`(grounding 检索)、`server/src/memory/reflection.ts`、`server/src/memory/reflection.test.ts`、`server/src/memory/persona-memory-repo.ts`(加按 kind 过滤检索)

- [ ] **Step 1: persona-memory-repo 支持只检索 fact/insight**
给 `retrieve` 加可选 `kinds?: ('episode'|'fact'|'insight')[]` 参数(默认全部);chat-engine grounding 调 `retrieve(id, query, 4, now, ['fact','insight'])`。TDD:加一条测试,混入 episode 与 fact,断言带 `['fact']` 时只回 fact。

- [ ] **Step 2: reflection 吃"玩家这局表现"而非角色自己的话**
改 `reflect(...)` 签名:接收本局 `playerMoves: { moveZh: string; cpLoss?: number; phase?: string }[]` 或一段 `gameSummary: string`(由调用方从 repo.getMoves + 诊断/或简单从 moveZh 列表拼)。reflect 把"玩家本局的走子表现"喂给 LLM,产出关于**玩家**的 insight(如"逢残局易急躁")写库(kind:insight, importance 4)。**不再读取该 persona 的 episode 作为反思输入。** 更新 reflection.test.ts:构造 playerMoves,FakeLLM 返回洞见,断言写入 insight 且内容关于玩家。

- [ ] **Step 3: ws-server 局末调用新版 reflect**
改 ws-server 局末反思:从 `repo.getMoves(gameId)` 取人方着法(byAi=false),映射出 moveZh 列表(可在 move 入库时存 moveZh,或局末重算),传给 reflect。保持 `reflectedGames` 幂等护栏。

- [ ] **Step 4: tsc + 全套 + commit**
```bash
npx tsc --noEmit -p server/tsconfig.json && npm -w server run test
git add server/src/memory/ server/src/chat/chat-engine.ts server/src/ws-server.ts
git commit -m "fix(memory): ground recall in player facts/insights; reflect on player's real play"
```

---

## Task 4: 接通导演心理信号(TDD)

**Files:** 改 `server/src/store/games-repo.ts`(+测试)、`server/src/session/game-session.ts`

- [ ] **Step 1: games-repo 加"最近战绩"查询**
加 `recentResults(humanSide: Side, limit: number): ('win'|'loss'|'draw')[]`(按 ended_at desc 取已结束局,把 result 相对 humanSide 映射)。TDD:插几局不同 result,断言映射与顺序正确。

- [ ] **Step 2: buildContext 用真实连胜/连败**
改 `game-session.ts` `buildContext`:从 `repo.recentResults(humanSide, 10)` 算当前 `winStreak`/`lossStreak`(从最近一局往前数连续同结果);`lastMoveMs` 用 session 内记录的上一手时间差(game-session 维护 `lastMoveAt:Map<gameId,ms>`,每手更新,用注入的 clock)。把真实值填进 `playerState`。注意 buildContext 需要拿到 humanSide——newGame 时已存 mode,照样存 humanSide(加 `humanSides:Map`)。
- TDD(game-session.test.ts 追加):预置 repo 有"人方两连败",新开局走一手,断言传给 director 的 ctx.playerState.lossStreak>=2(可通过注入一个捕获 ctx 的假 selectMove?——或把 buildContext 提取为可测的纯函数 `computePlayerState(results, lastMoveMs)` 并直接测它)。**推荐:抽出纯函数 `computePlayerState` 单测**,buildContext 调它。

- [ ] **Step 3: tsc + 全套 + commit**
```bash
npx tsc --noEmit -p server/tsconfig.json && npm -w server run test
git add server/src/store/games-repo.ts server/src/store/games-repo.test.ts server/src/session/
git commit -m "fix(director): wire real win/loss streak + move timing into psychology signals"
```

---

## Task 5: 质量测试兜底 + AI 棋手开口(TDD)

**Files:** 改 `server/src/chat/chat-engine.test.ts`、`server/src/chat/speaker-select.ts`(让 player 也能入选)或 chat-engine(单独让 AI 棋手偶尔点评)

- [ ] **Step 1: 内容质量断言(堵虚假绿)**
chat-engine.test 加:给一串带不同 moveZh 的 move 刺激,断言每条 emit 的 prompt 都包含对应 moveZh(角色"看得见棋");并断言去重护栏在重复输出时生效。

- [ ] **Step 2: AI 棋手(player)也能开口**
让 `player` 角色在**自己走完一手后**偶尔自评(如"我这步稳一手")。最小实现:chat-engine 暴露 `playerRemark(stim)`,ws-server 在 AI 着刺激后以小概率调用;或把 player 纳入候选池但仅在 side==player 的着法上。**保持简洁**:加一个低频开关,默认每 ~3 手 AI 自评一次,用 FakeLLM 测可触发。

- [ ] **Step 3: tsc + 全套 + commit**
```bash
npx tsc --noEmit -p server/tsconfig.json && npm -w server run test
git add server/src/chat/
git commit -m "test(chat): assert move-grounding + dedup; AI player occasional self-remark"
```

---

## Task 6: 端到端真机复验(手动,需引擎+key)

- [ ] **Step 1:** 起后端(`npm run dev:server`,.env 已含 PIKAFISH_PATH+ARK),用 WS 脚本走 5-6 手(每手后用 perft 取一个合法人着自动续走),抓全部 chat 行。
- [ ] **Step 2:** 人工核对:弹幕**点到真实着法**(出现"炮二平五/马2进3"之类)、**不再雷同重复**、不同角色视角有别。把真实输出贴进报告。**不要伪造**。
- [ ] **Step 3:** 查 DB `persona_memory`:局末应出现 `insight`(关于玩家),不再是清一色"雾里看花" episode。

---

## 验收标准(修复完成定义)

- 弹幕**引用真实着法与真实优劣**(随便截几条都能对上盘面),不再"看不懂/雾里看花"刷屏。
- 同一角色不逐字/近似重复(去重护栏);不同角色视角与口吻有别。
- `persona_memory` 出现关于**玩家**的 insight;反思输入是玩家的真实走子,不是角色自己的话。
- 导演 `playerState` 反映真实连胜连败/用时(纯函数 `computePlayerState` 有单测)。
- 新增"内容质量"测试能在回归时抓住"prompt 不含真实着法/逐字重复"。
- 全套后端测试通过;真机端到端人工复验通过(贴真实输出)。

## 已知简化(ponytail,本轮不做)

- 中文记谱不做 前/后 同子消歧、不标"将军"。
- phase 用手数粗分,非按子力。
- 反思的"玩家表现"用 moveZh 列表(+可选 cpLoss),未深度接 M2 诊断;够用,后续可升级。
