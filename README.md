# 围观象棋

中国象棋 AI 陪练工具——支持和 AI 对弈,下完后可在复盘页逐步回顾对局。M1 实现了核心对弈闭环:从落子到 AI 应答,再到对局持久化与复盘。

---

## 技术栈

| 层次 | 技术 |
|------|------|
| 后端 | Node.js + Fastify + `@fastify/websocket`、SQLite (`better-sqlite3`)、Pikafish(UCI 象棋引擎)、`elephantops`(规则库) |
| 前端 | Vite + React 18 + TypeScript、`react-xiangqiboard`(棋盘组件) |

---

## 目录结构

```
围观象棋/
├── server/          # 后端(WebSocket 服务 + AI 引擎封装 + SQLite 存储)
│   └── src/
│       ├── engine/      # Pikafish UCI 封装与解析
│       ├── director/    # 导演控制器(陪练防穿帮 + 拟人采样)
│       ├── rules/       # elephantops 适配层(合法着法、坐标转换)
│       ├── session/     # GameSession 对局编排
│       ├── store/       # SQLite 持久化(games / moves)
│       ├── ws-server.ts # WebSocket 对弈入口
│       └── index.ts     # 服务启动(需 PIKAFISH_PATH)
├── web/             # 前端
│   └── src/
│       ├── board/       # 棋盘相关组件
│       ├── pages/       # PlayPage(对弈)、ReviewPage(复盘)
│       └── main.tsx
├── docs/
│   └── superpowers/plans/
│       └── M1-OPEN-ISSUES.md   # 已知风险与待验证项
└── package.json     # npm workspaces 根配置
```

---

## 前置依赖

1. **Node.js 20+**（开发期在 Node 25 上实测可用）
2. **Pikafish 可执行文件 + NNUE 权重**

   从 [Pikafish 官方仓库](https://github.com/official-pikafish/Pikafish) 下载对应平台的二进制文件与 NNUE 权重文件，放入项目根目录下的 `engine/` 文件夹：

   ```
   engine/
   ├── pikafish         # 或 pikafish.exe（Windows）
   └── pikafish.nnue    # NNUE 权重文件
   ```

   > **注意**：实现期需自行核对 Pikafish 及 NNUE 权重的开源许可证（GPL v3）以及各平台（macOS/Linux/Windows）二进制的可用性。

---

## 运行步骤

**第一步：安装依赖**

```bash
npm install
```

**第二步：启动后端**

```bash
export PIKAFISH_PATH=./engine/pikafish   # macOS/Linux
# Windows: set PIKAFISH_PATH=.\engine\pikafish.exe

npm run dev:server
# → WebSocket 监听 ws://localhost:8787/play
# → HTTP 只读接口 GET http://localhost:8787/games/:id
```

**第三步：另开终端，启动前端**

```bash
npm run dev:web
# → http://localhost:5173
```

**第四步：浏览器访问**

打开 `http://localhost:5173`，进入对局页与 AI 对弈；对局结束后可前往复盘页逐步回顾。

---

## 测试

**后端单元测试（vitest，67 个用例，含 M1 + M2）：**

```bash
npm -w server run test
```

**前端类型检查 + 生产构建：**

```bash
npm -w web run typecheck
npm -w web run build
```

---

## 已知限制与待办

详见 [`docs/superpowers/plans/M1-OPEN-ISSUES.md`](docs/superpowers/plans/M1-OPEN-ISSUES.md)。

主要注意点：

- **坐标朝向需端到端验证**：`elephantops` 适配层（`server/src/rules/position.ts` 的 `elToPika`/`pikaToEl`）在单测内部自洽，但接入真实 Pikafish 二进制后需核对引擎返回的 move 字符串与适配层记法是否一致。若出现"illegal move"，把映射公式从 `10 - rank` 改为 `rank - 1` 即可（前端 Board 同理）。
- **完整端到端对弈**需提供 Pikafish 二进制后才能验证，M1 代码逻辑已具备完整闭环，但引擎连接部分未经真机测试。

**后续里程碑（M3 尚未实现）：**

- **M3**：AI 棋手人设、观棋者视角、长期记忆、语音交互。

---

## M2：智能分析层

M2 在 M1 对弈闭环基础上增加了「局后自动诊断」能力：对每一手棋打分、贴标签，并聚合为弱点画像、成长曲线和训练题组。

### 功能简介

| 功能 | 说明 |
|------|------|
| 逐手诊断 | 调用 Pikafish 对每手棋评分，计算 cp 丢分；按开局/中局/残局标注阶段，同时打「主题标签」（吃子、闲手、丢子、防守、将军等） |
| 弱点画像 | 按阶段 × 标签聚合历史诊断数据，找出哪个阶段哪类失误最多 |
| 训练题 | 从历史败局中提取丢分超过阈值的关键局面，生成复盘训练题组 |
| 成长曲线 | 每局诊断后写入 `growth_metrics` 快照；前端展示 ACPL、准确率、估算 Elo 随对局数的变化趋势 |
| 历史对比 | 对比最近两段历史的各项指标，输出规则版文字摘要（LLM 措辞接口留给 M3） |

### 诊断用法

先按 M1 说明下完并存一局，获得 `gameId`（整数，可在网络请求或 URL 中看到）；然后任选一种方式触发诊断：

**命令行触发**（会真跑 Pikafish 逐手分析，手数越多耗时越长）：

```bash
curl -X POST http://localhost:8787/games/<id>/diagnose
```

**浏览器触发**：

打开 `http://localhost:5173/#/analysis/<id>`，点击「诊断本局」按钮。

诊断完成后：

- `http://localhost:5173/#/growth` — 成长曲线、弱点分布、两段历史对比
- `http://localhost:5173/#/training/<id>` — 当局失误复盘训练题

### 分析 API 一览

| 端点 | 说明 |
|------|------|
| `POST /games/:id/diagnose` | 触发指定局的逐手诊断（异步，Pikafish 分析完后写入 DB） |
| `GET /games/:id/diagnosis` | 查询某局诊断结果（逐手 cp_loss + 阶段 + 标签） |
| `GET /growth` | 返回全量 `growth_metrics` 快照列表（成长曲线数据点） |
| `GET /weakness?side=red\|black` | 返回弱点画像（按阶段 × 标签聚合的失误分布） |
| `GET /games/:id/drills` | 返回当局训练题组（关键失误局面 + 最佳走法） |
| `GET /compare` | 返回最近两段历史的对比摘要（ACPL、准确率、Elo 趋势等） |

### 前端路由

| 路由 | 页面 |
|------|------|
| `#/` | 对局（与 AI 对弈） |
| `#/review/:id` | 复盘（逐步回顾对局记录） |
| `#/analysis/:id` | 诊断（触发 + 查看逐手诊断结果） |
| `#/growth` | 成长（成长曲线 + 弱点画像 + 历史对比） |
| `#/training/:id` | 训练（失误复盘题组） |

### 已知简化项（诚实记录）

- **估算 Elo** 为 ACPL 粗映射（`2600 - 6 × ACPL` 钳制在合理区间），仅供看趋势，非真实棋力评级。
- **弱点画像** 用 SQL 聚合查询动态计算，未物化 `weakness_profile` 表（个人单机数据量小，无需物化）。
- **`hangs_piece`（丢子）** 标签用「本方此手后经对手一手、子力净减少」近似判定，非严格对杀计算。
- **单局诊断页** 展示每手 cp 丢分；绝对评分曲线未存入 DB（接口已预留）。
- **历史对比** 为规则版文字摘要；LLM 措辞留 `ReportProvider` 接口给 M3 接入。
- **图表库**：前端使用 [recharts](https://recharts.org/)。
- **M2 设计 §5.4「专项陪练」** 已裁剪到 M2.5，将复用 M1 对弈 + 弱点画像选场景实现，M2 本轮不包含。
