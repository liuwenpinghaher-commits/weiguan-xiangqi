# Phase 1: 对弈核心体验升级 设计文档

## 目标

补全对弈功能缺失的棋钟、认输/提和/悔棋、走法历史、合法走法提示、棋盘倒置、棋子动画六大体验，使对弈从"能用"提升到"完整可用"。

## 功能详述

### 1. 时间控制（棋钟）

**服务端 GameSession：**

```ts
// game-session.ts
interface ClockState {
  initialSeconds: number      // 默认 600 (10分钟)
  incrementSeconds: number    // 默认 5 (每步加秒)
  redRemainingMs: number
  blackRemainingMs: number
  startedAt: number | null    // 当前计时方时钟启动时间戳
  activeSide: 'red' | 'black' | null
}
```

- `startClock(gameId, side)` — 某方走完，另一方开始计时
- `pauseClock(gameId)` — 暂停计时（游戏暂停时）
- `checkTimeout(gameId)` — 轮询检查，超时则自动判负
- 时钟通过 `setInterval` 每 500ms 检查一次
- 配置项放在 `engine` 段的 `DEFAULTS` 中（复用现有 config 结构）

**前端 PlayPage：**

- 棋盘上方显示两个数字钟：`MM:SS` 格式
- 当前走棋方高亮（金色边框），对方灰色
- 倒计时 <30s 变红闪烁
- 通过 WebSocket `update` 消息携带 `clockState` 字段同步时间
- 使用 `requestAnimationFrame` 驱动本地倒计时（不与服务端频繁同步）

**Config 新增：**
```ts
// defaults.ts EngineCfg 新增
clockInitialSeconds: number   // 600
clockIncrementSeconds: number // 5
```

---

### 2. 认输 / 提和 / 悔棋

**服务端 WebSocket 消息：**

| type | 方向 | payload | 行为 |
|------|------|---------|------|
| `resign` | client→server | `{gameId}` | 立即结束，humanSide 判负 |
| `draw_offer` | client→server | `{gameId}` | AI 按概率接受（coach 80%、humanlike 60%），返回 `draw_response` |
| `draw_response` | server→client | `{accepted}` | 前端弹窗告知结果 |
| `undo` | client→server | `{gameId}` | 撤回人类+AI 各一步，每局限 3 次，仅 coach 模式 |
| `undo_result` | server→client | `{success, remaining}` | 结果反馈 |

**前端 PlayPage 按钮：**

```
[认输] [提和] [悔棋(3)]
```

- 认输弹出确认对话框（`window.confirm` 或自定义 modal）
- 提和发送后等待 `draw_response`，弹窗显示结果
- 悔棋成功后 `remaining` 减一，归零时按钮灰掉
- 悔棋恢复上一步 FEN，引擎重算新的 best move

---

### 3. 走法历史面板

**新组件 `web/src/board/MoveList.tsx`：**

- 两列布局：`N. ♟红方走法   ♟黑方走法`（标准棋谱格式）
- 走法使用中文描述（`describeMoveZh` 已有，从 stimulus 中取 `moveZh`）
- 当前步高亮蓝色背景
- 点击任意步 → `onNavigate(ply)` 回调
- 键盘 ← → 导航（通过 `useEffect` 监听 `keydown`）
- 最大高度 300px，超出滚动
- 空状态："暂无走法"

**PlayPage 集成：**

- `plyIndex` 状态：当前查看的步数（0 = 开局，最新 = moves.length）
- 非最新步时 Board `disabled=true`，顶部提示"查看历史走法 | 回到最新"
- 新走法到达时自动跳到最新步（除非用户手动导航到历史步）
- `fenKey` 机制保持：切换 ply 时设置 Board FEN 为对应步的 `fenAfter`

**数据来源：**
- 每次 `update` 消息中已有 `stimulus.moveZh` 和 `stimulus.kind`
- 走法面板从 `moves` 数组构建（playHumanMove 和 aiFirstMove 的返回值已包含）

---

### 4. 合法走法提示

Phase 1 使用服务端端点方式（简单可靠，无需前端引入规则库）。

**服务端新增端点：**
- `GET /legal-moves?fen=<FEN>&square=<square>` 返回 `{ squares: string[] }`
- 使用 `elephantops` 的 `Position.legalMoves()` 计算
- FEN 参数需 URL encode

**前端 Board 组件：**
- Board 维护 `legalSquares: string[]` 状态
- 点击己方棋子 → `fetch(/legal-moves?fen=...&square=...)` → 更新 legalSquares
- 目标格子上叠加半透明绿色圆点（CSS 绝对定位 overlay）
- 点击圆点或合法目标格 → 走棋
- 点击其他格子 → 清除圆点
- 点击时顺带缓存该位置的走法列表，减少重复请求

---

### 5. 棋盘倒置

**Board 组件：**

```tsx
interface BoardProps {
  // ...existing
  orientation?: 'red' | 'black'  // 默认 'red'
}
```

- 传给 `react-xiangqiboard` 的 `boardOrientation` prop
- 坐标标注自动适配（`a0..i9` 从当前视角显示）

**PlayPage：**

- 人类选黑方 → `orientation='black'`
- 右上角翻转按钮 `🔄`，点击切换
- 翻转后走法坐标按当前视角发送给服务器（服务器始终用红方坐标）

---

### 6. 棋子动画 + 预走

**棋子动画：**

`react-xiangqiboard` v0.1.12 的 `Chessboard` 组件检查：

```tsx
<Chessboard
  animationDuration={300}  // 300ms 滑动动画
  ...
/>
```

如果库不支持，通过 `key` prop 刷新替代（当前已有 `fenKey` 机制，但无动画）。

**预走（pre-move）：**

仅在 `humanlike` 模式开启。

- AI 思考期间（`awaitingAi=true`），用户可以点击一个棋子再点击目标格
- 预走棋子显示半透明虚线轮廓，目标格显示浅色标记
- AI 走完后，检查预走是否合法：
  - 合法 → 自动执行
  - 不合法 → 清除预走，用户正常走棋
- PlayPage 维护 `preMove: {from, to} | null` 状态
- 通过 `onMove` 回调的正常流程发送走法

---

## 文件改动

| 操作 | 文件 | 内容 |
|------|------|------|
| 修改 | `server/src/session/game-session.ts` | ClockState 管理、resign/draw/undo 逻辑、timeout 检测 |
| 修改 | `server/src/config/defaults.ts` | EngineCfg 新增 clockInitialSeconds、clockIncrementSeconds |
| 修改 | `server/src/config/validate.ts` | engine 段新增时钟参数校验 |
| 修改 | `server/src/ws-server.ts` | 新 WS 消息类型：resign/draw_offer/undo + 响应；GET /legal-moves 端点 |
| 修改 | `server/src/session/stimulus-kind.ts` | 新增 draw_accepted/draw_rejected/undo stimulus 类型 |
| 新建 | `web/src/board/MoveList.tsx` | 走法历史面板组件 |
| 新建 | `web/src/board/LegalMoveDots.tsx` | 合法走法提示圆点 overlay |
| 修改 | `web/src/board/Board.tsx` | orientation prop、animationDuration、legalMoves 集成、preMove 显示 |
| 修改 | `web/src/pages/PlayPage.tsx` | 棋钟显示、认输/提和/悔棋按钮、MoveList、plyIndex 导航、preMove 状态 |
| 修改 | `web/src/chat/ChatPanel.tsx` | 可能需要适配布局变化 |
| 修改 | `web/src/api/ws-client.ts` | 新消息类型类型定义 |
| 修改 | `web/src/ui/theme.ts` | 新增钟表颜色、倒计时闪烁动画样式 |

## 数据库变更

无需新增表。`games` 表现有字段足够：
- `result` 已有，认输/超时写入对应 result 值
- 时间信息可从 `moves` 表的时间戳推算（不做精确 clock 持久化，进程重启后重新开始计时）

## 测试

- `server/src/session/game-session.test.ts`：clock 超时测试、undo 边界测试、draw 概率测试
- `server/src/ws-server.test.ts`：resign/draw/undo WS 消息端到端测试
- `web/src/board/MoveList.test.ts`：走法列表渲染、导航交互测试
- `web/src/board/coords.test.ts`：补充 orientation 翻转坐标测试

## 不在范围

- 不做精确棋钟持久化（重启丢时间可接受）
- 不做 PGN/FEN 导出格式改进
- 不做 AI 走法预测（预走使用纯合法性检查，不预测 AI 走法）
