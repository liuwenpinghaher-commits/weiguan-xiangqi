# 围观象棋

中国象棋 AI 陪练工具——支持和 AI 对弈（陪练/拟人两种模式）、下完后复盘、局后智能诊断与训练、以及有性格的观棋者实时弹幕聊天（含语音）。

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 | Node.js + Fastify + `@fastify/websocket`、SQLite (`better-sqlite3`)、Pikafish（UCI 象棋引擎，可选）、`elephantops`（规则库） |
| 前端 | Vite + React 18 + TypeScript、`react-xiangqiboard`（棋盘组件）、recharts（图表） |
| LLM | 阿里云百炼 DashScope（`qwen-plus-latest`,控制台可换模型/热重载;无 key 时 FakeLLM 占位） |
| 语音 | 服务端 TTS：百炼云 `qwen3-tts-flash`（`DASHSCOPE_TTS_*` 环境变量，不可用时回退浏览器 Web Speech）；服务端 STT：百炼 `qwen3-asr-flash`；浏览器 Web Speech 作兜底 |

---

## 目录结构

```
围观象棋/
├── server/             # 后端（WebSocket 服务 + AI 引擎封装 + SQLite 存储）
│   └── src/
│       ├── engine/         # Pikafish UCI 封装与解析（uci-parse, engine）
│       ├── director/       # 导演控制器（陪练/拟人模式强度调度）
│       ├── rules/          # elephantops 适配层（合法着法、坐标转换、中文描述）
│       ├── session/        # GameSession 对局编排（player-state, game-session）
│       ├── store/          # SQLite 持久化（games/moves/messages/analysis/training/memory）
│       │   ├── schema.sql
│       │   ├── games-repo.ts
│       │   ├── messages-repo.ts
│       │   ├── analysis-repo.ts
│       │   ├── training-repo.ts
│       │   └── game-export.ts
│       ├── analysis/       # 逐手诊断（cploss, elo, phase, tags, diagnose-game）
│       ├── training/       # 训练题生成（generate-drills）
│       ├── report/         # 历史对比（compare）
│       ├── memory/         # 角色语义记忆(SQLite store,JS 算余弦 + reflection + judge)
│       ├── chat/           # 聊天引擎（chat-engine, speaker-select, tempo）
│       ├── personas/       # 角色定义与差异化引擎读数（personas, engine-view）
│       ├── llm/            # LLM 抽象（dashscope, mutable, embedding, fake）
│       ├── ws-server.ts    # HTTP+WebSocket 路由总入口
│       └── index.ts        # 服务启动（引擎/LLM 均为可选）
├── web/                # 前端
│   └── src/
│       ├── board/          # 棋盘组件（Board, coords）
│       ├── charts/         # 数据图表（ScoreLine, WeaknessRadar）
│       ├── chat/           # 聊天面板（ChatPanel）
│       ├── voice/          # 语音（browser-tts, use-speech-input, voice-config）
│       ├── hooks/          # 通用 hooks（use-viewport）
│       ├── ui/             # 页面壳（PageShell）
│       ├── api/            # 接口封装（http-client, ws-client, config, contracts）
│       ├── pages/          # 五大页面
│       │   ├── PlayPage.tsx     # 对弈（含模式/换边/聊天/语音）
│       │   ├── ReviewPage.tsx   # 复盘（含对话回放）
│       │   ├── AnalysisPage.tsx # 诊断
│       │   ├── GrowthPage.tsx   # 成长曲线 + 弱点画像 + 历史对比
│       │   └── TrainingPage.tsx # 训练题
│       └── main.tsx        # hash 路由入口
├── engine/             # Pikafish 二进制 + NNUE 权重（需自行下载，见下）
├── docs/
│   └── superpowers/
│       ├── AUDIT-2026-06-20.md
│       └── plans/
│           └── M1-OPEN-ISSUES.md
└── package.json        # npm workspaces 根配置
```

---

## 前置依赖

1. **Node.js 20+**（开发期在 Node 25 上实测可用）

2. **Pikafish 可执行文件 + NNUE 权重（可选，无引擎仍可聊天和查复盘）**

   从 [Pikafish 官方仓库](https://github.com/official-pikafish/Pikafish) 下载对应平台二进制与 NNUE 权重，放入 `engine/`：

   ```
   engine/
   ├── pikafish        # 或 pikafish.exe（Windows）
   └── pikafish.nnue   # NNUE 权重文件
   ```

   > 注意：Pikafish 采用 GPL v3 许可证。使用前请核对各平台二进制可用性。
   > **无引擎时降级：** 对弈/诊断功能不可用，聊天与复盘仍可用。

3. **百炼 DASHSCOPE_API_KEY（可选，无 key 仍可对弈和诊断）**

   配置 `server/.env`（见 `server/.env.example`，勿提交）：

   ```
   DASHSCOPE_API_KEY=你的百炼 key
   DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
   ```

   > **无 key 时降级：** 观棋聊天功能不可用（FakeLLM 占位），对弈/诊断照常运行。

---

## 端口约定（固定）

本项目固定使用：**后端 3410 / 前端 3420**。

- 后端：`server/src/index.ts`（可用环境变量 `PORT` 覆盖，默认 3410）
- 前端：`web/vite.config.ts`（`strictPort`，固定 3420）
- 前端访问后端的地址集中在一处：`web/src/api/config.ts`（`API_HOST=localhost:3410`）

---

## 运行步骤

### 开发模式

**第一步：安装依赖**

```bash
npm install
```

**第二步：启动后端**

```bash
# 有引擎时（对弈+诊断全功能）
export PIKAFISH_PATH=./engine/pikafish   # macOS/Linux
# Windows: set PIKAFISH_PATH=.\engine\pikafish.exe
npm run dev:server

# 无引擎时（聊天/复盘模式）
npm run dev:server
# 后端会自动降级，打印 warn 并继续启动
```

**第三步：另开终端，启动前端**

```bash
npm run dev:web
# → http://localhost:3420
```

### 生产模式

```bash
# 构建后端
npm -w server run build

# 启动生产后端
export PIKAFISH_PATH=./engine/pikafish
npm -w server run start
# → 监听 http://localhost:3410

# 前端生产构建
npm -w web run build
# → dist/ 可托管到任意静态服务
```

> **优雅关闭：** 收到 `SIGTERM`/`SIGINT` 时，服务关闭 Pikafish 子进程并刷写 SQLite WAL，再退出。

> **重启续局：** 对局元数据持久化在 SQLite；重启后已完成局可复盘，进行中的局需重开（内存状态不跨进程）。

---

## WebSocket 与 HTTP 路由一览

### WebSocket — `ws://localhost:3410/play`

| 客户端消息 | 说明 |
|-----------|------|
| `{type:'new', mode:'coach'\|'humanlike', humanSide:'red'\|'black', startFen?}` | 新对局（若执黑且引擎可用，AI 先手） |
| `{type:'move', gameId, move}` | 提交人类着法 |
| `{type:'say', gameId, text}` | 玩家发言（触发观棋者响应） |

| 服务端推送 | 说明 |
|-----------|------|
| `{type:'started', gameId}` | 对局已建立 |
| `{type:'update', fen, lastMove, scoreCp, over?, result?}` | 局面更新（含 AI 应手） |
| `{type:'chat', personaId, text, addressee, ts}` | 观棋者/AI 棋手发言 |
| `{type:'error', message}` | 错误提示 |

### HTTP 路由

| 端点 | 说明 |
|------|------|
| `GET /games/:id` | 复盘数据（对局 + 走法 + 聊天消息） |
| `POST /games/:id/diagnose` | 触发局后诊断（需引擎，异步） |
| `GET /games/:id/diagnosis` | 逐手诊断结果（cp\_loss + 阶段 + 标签） |
| `GET /games/:id/drills` | 训练题组 + 进度 stats |
| `POST /games/:id/drills/attempt` | 提交训练作答（后端判定 correct + 回写 stats） |
| `GET /growth` | 成长曲线数据点（逐局指标时间序列） |
| `GET /weakness?side=red\|black` | 弱点画像（按阶段 × 标签聚合） |
| `GET /compare` | 最近两段历史对比摘要 |
| `GET /training/stats` | 全局训练进度 |
| `GET /games/:id/export` | 单局导出（JSON，触发浏览器下载） |
| `GET /export` | 全库导出（JSON） |
| `POST /games/import` | 棋谱导入（本系统 JSON 格式） |

---

## 前端路由

| Hash 路由 | 页面 |
|----------|------|
| `#/` | 对局（陪练/拟人模式切换、换边、聊天、语音） |
| `#/review/:id` | 复盘（逐步回顾走法 + 对话回放） |
| `#/analysis/:id` | 诊断（触发 + 查看逐手 cp\_loss） |
| `#/growth` | 成长曲线 + 弱点画像 + 历史对比 |
| `#/training/:id` | 训练题（失误复盘题组） |

---

## 功能概览

### 对弈核心

- 陪练模式（coach）与拟人模式（humanlike）可实时切换
- 一键换边（执红/执黑，执黑时 AI 自动先手）
- WS 断连自动重连（指数退避）
- 最后一手高亮、AI 思考时锁盘防误操作、输赢结果展示
- 非法着法提示

### M2：局后诊断与成长飞轮

| 功能 | 说明 |
|------|------|
| 自动诊断 | 对局结束后**自动后台触发** Pikafish 逐手分析，写入 DB |
| 逐手诊断 | 计算 cp\_loss（mate 丢分封顶 1000），按阶段（开/中/残）分类，打主题标签 |
| 弱点画像 | 按阶段 × 标签聚合历史数据，找出最频繁的失误类型 |
| 训练题 | 从失误局面生成题组；作答由后端判定 correct 并持久化 |
| 训练回写 | `drill_attempts` 记录正确率与统计；弱点画像暂不自动反哺 |
| 成长曲线 | 逐局写入 `growth_metrics`（ACPL、准确率、估算 Elo） |
| 历史对比 | 前后两段指标对比（规则版文字摘要） |

### M3a：角色与聊天

四位有性格的观棋者（老黑/炮儿爷/林教练/吃瓜阿强）在对弈中实时弹幕：
- 各角色看到**差异化的引擎读数**（弱角色有噪声，真的会看走眼）
- 发言调度：加权打分（张力 × 角色 × 去重）决定谁说/何时说
- 同回合其他角色最近发言注入 prompt，支持接话/拉踩/抬杠
- 玩家可打字/语音与观棋者对话
- 聊天落库（`messages` 表）；复盘页回放对局对话
- 冷场定时器：20 秒触发概率 35% 的 idle 刺激（张力 0.55）
- 中途关页面（≥6 手人类走法）也触发反思，沉淀跨会话记忆

### M3b：语音

- **TTS**：观棋者每条发言用 `SpeechSynthesis` 朗读，音高/语速区分角色
- **STT**：点麦克风，中文说话识别为文字走 `say` 路径
- **语音开关**：持久化；新局自动清队列
- 优雅降级：浏览器不支持时按钮禁用 + 提示

---

## 测试

**后端（vitest）：**

```bash
npm -w server run test
# 179 tests passed (31 test files)
# 含：单元测试（rules/analysis/chat/session/memory/training/report）
#     + ws-server 端到端集成测试（真实 Position + Fake 引擎/LLM，HTTP + WS 完整流程）
```

**前端（vitest）：**

```bash
npm -w web run test
# 18 tests passed (2 test files)
# 含：棋盘坐标往返测试、WS 契约一致性测试
```

**前端类型检查 + 生产构建：**

```bash
npm -w web run typecheck
npm -w web run build
```

**验证 LLM 连通（需 .env）：**

```bash
node --env-file=server/.env --import tsx server/scripts/smoke-llm.ts
```

---

## 数据库结构（SQLite）

| 表 | 说明 |
|----|------|
| `games` | 对局元数据（模式、执方、结果、起始 FEN） |
| `moves` | 逐手走法（含 FEN、评分、是否 AI） |
| `messages` | 聊天消息（角色发言 + 玩家发言，按局持久化） |
| `move_annotations` | 逐手诊断标注（cp\_loss、bestMove、阶段、主题） |
| `growth_metrics` | 逐局成长指标快照（ACPL、准确率、估算 Elo） |
| `drill_attempts` | 训练作答记录 |
| `persona_memory` | 角色长期记忆（episode / fact / insight） |

---

## 已知简化与限制（诚实记录）

- **坐标朝向**：`elToPika`/`pikaToEl` 已经对真机 Pikafish perft 验证，映射公式 `pika_rank = el_rank - 1` 正确，单测与真实引擎对齐。
- **长捉（perpetual chase）未实现**：长将用「同一局面重复三次 → 认负」近似处理；长捉暂无判定，不等同于完整象棋规则。
- **60 回合无吃子和棋**：已实现（`isDrawBy60Move`）；原 elephantops 的 50 半回合错误判和已修复。
- **mate 丢分**：封顶 1000 cp（避免单手 3 万污染 ACPL）；实际让将或被将杀时影响仍会反映，但不再产生断崖。
- **估算 Elo**：`2600 - 6 × ACPL` 粗映射，仅供看趋势，非真实棋力评级。
- **弱点画像**：SQL 实时聚合，不物化（单机数据量小）。
- **训练回写**：`drill_attempts` 记录正确率统计；暂不自动反哺弱点画像画像权重。
- **导出/导入**：本系统 JSON 格式往返（export → import 完整还原）；不解析 PGN / ICCS 等外部棋谱格式。
- **黑方棋盘视角**：顶部为黑方，`react-xiangqiboard` 组件不翻转棋盘——执黑时棋盘视觉方向不切换，功能可用但非标准黑方视角。
- **记忆检索**：中文按字、英文按词的重合度匹配，非嵌入语义检索。
- **角色互动**：同回合聊天上下文已注入 prompt；但仅注入最近发言文本，不含完整的"角色关系旧账"建模。
- **`hangs_piece`（丢子）标签**：用对手一手后子力净减少近似，非严格对杀计算。
- **历史对比**：规则版文字摘要；LLM 措辞接口（`ReportProvider`）留给后续扩展。
- **浏览器语音**：TTS 音色依赖系统，Chrome/Edge 最佳；STT 为一次性听写，非持续聆听；Firefox 基本无 STT。
- **Pikafish 强度档**：`UCI_Elo`/`LimitStrength` 暂未下发，拟人模式靠 MultiPV 浅采样近似强度差异。
- **训练反哺**：训练正确率已用于排除已答对题目,但暂不反哺弱点画像权重(计划中)。
- **导演心流 EDDA**：悔棋频率/参与度趋势等字段尚未采集；当前仅连败时静态下调评分带。

---

## M1 对弈闭环说明

M1 实现了完整的对弈闭环：从落子到 AI 应答，再到对局持久化与复盘。

- 引擎封装：队列 + 超时 + 进程崩溃 reject
- GameSession 原子落库回滚
- 终局规则：将死、重复局面（三次）、60 回合无吃子、长将（近似）

---

## M2：智能分析层

M2 在对弈闭环基础上增加了局后自动诊断：

- 对局结束后**自动**触发 Pikafish 逐手评分（fire-and-forget，不阻塞主流程）
- 成长曲线（ACPL / 准确率 / 估算 Elo）、弱点画像、训练题
- 训练作答回写 `drill_attempts`，正确率统计可查

---

## M3a：角色与聊天（文字版）

见功能概览。LLM 配置（`server/.env`）：

```
DASHSCOPE_API_KEY=你的百炼 key
DASHSCOPE_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1
```
> 模型在控制台"密钥与模型"页配置(默认 `qwen-plus-latest`),可热重载。

---

## M3b：语音

服务端 TTS 走百炼云 qwen3-tts-flash(GET /tts,DASHSCOPE_TTS_* 环境变量),不可用时回退浏览器 Web Speech;
STT 走百炼 qwen3-asr-flash(POST /asr),浏览器 Web Speech 兜底。
