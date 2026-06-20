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

## 端口约定（固定）

本项目固定使用:**后端 3410 / 前端 3420**。

- 后端:`server/src/index.ts`(可用环境变量 `PORT` 覆盖,默认 3410)
- 前端:`web/vite.config.ts`(`strictPort`,固定 3420)
- 前端访问后端的地址集中在一处:`web/src/api/config.ts`(`API_HOST=localhost:3410`)

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
# → WebSocket 监听 ws://localhost:3410/play
# → HTTP 只读接口 GET http://localhost:3410/games/:id
```

**第三步：另开终端，启动前端**

```bash
npm run dev:web
# → http://localhost:3420
```

**第四步：浏览器访问**

打开 `http://localhost:3420`，进入对局页与 AI 对弈；对局结束后可前往复盘页逐步回顾。

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
curl -X POST http://localhost:3410/games/<id>/diagnose
```

**浏览器触发**：

打开 `http://localhost:3420/#/analysis/<id>`，点击「诊断本局」按钮。

诊断完成后：

- `http://localhost:3420/#/growth` — 成长曲线、弱点分布、两段历史对比
- `http://localhost:3420/#/training/<id>` — 当局失误复盘训练题

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

---

## M3a：角色与聊天（文字版）

对弈时,2-3 个**有性格、有身世、会看走眼**的观棋者围着棋局**与回合解耦**地自然冒泡:点评、拉踩、接梗、闲聊;玩家可打字与他们对话。角色跨会话记得你(长期记忆 + 反思)。语音留给 M3b。

### LLM 配置（火山方舟 / 豆包）

大脑用火山方舟(OpenAI 兼容),配置三个环境变量(放 `server/.env`,见 `server/.env.example`,**勿提交**):

```
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/coding/v3
ARK_API_KEY=你的火山 key
ARK_MODEL=doubao-seed-2.0-pro
```

- 观棋者高频弹幕默认 `thinking:{type:"disabled"}` 关推理(实测一句约 83 token);诊断/反思才开推理。
- 单独验证 LLM:`node --env-file=server/.env --import tsx server/scripts/smoke-llm.ts`。

### 角色与机制

| 角色 | 棋力档 | 帮踩倾向 |
|------|--------|----------|
| 老黑(AI 棋手) | 强 | 你的对手 |
| 炮儿爷(观棋) | 强 | 专踩软招,妙手真心叫好 |
| 林教练(观棋) | 中 | 偏帮你,给提示 |
| 吃瓜阿强(观棋) | 弱 | 墙头草,谁优势踩谁 |

- **防趋同**:按棋力档给角色**差异化的引擎读数**(弱角色读数含噪、真的会看走眼),不只靠 prompt。
- **集中式发言调度**:加权打分(张力 + 随机 − 最近发言惩罚)决定谁说/说不说,规则优先于纯 LLM。
- **节奏护栏**:最小静默间隔 + 每分钟上限,防刷屏/防 token 失控。
- **长期记忆 + 反思**:每句发言记 episode;局末把零散观察抽象成高权重 insight,检索注入后续对话。

### 聊天协议

- 后端推 `{type:'chat', personaId, text, addressee, ts}`;前端发 `{type:'say', gameId, text}` 与观棋者对话。
- 刺激来源:落子 / 妙手漏着 / 玩家说话 / 冷场定时器(与回合解耦)。

### 已知简化项（诚实记录）

- 记忆相关度用「中文按字 + 英文按词」重合度,非嵌入语义检索(数据量小够用)。
- 张力为评分/丢分的粗映射;冷场用定时器 + 低张力刺激。
- 一个豆包模型 + thinking 开关覆盖「弹幕/分析」两档,未做多模型路由。
- 首版让**观棋者**主动冒泡;AI 棋手主动搭话为后续小扩展。
- 端到端聊天需后端运行 + ARK key;`VolcanoLLM` 与 `say` 路径已真实冒烟,完整对局内联动需本机起服务验证。

---

## M3b：语音（浏览器原生)

全程语音,**零新凭证、零新依赖**——用浏览器内置 Web Speech API:

- **念弹幕(TTS)**:观棋者/棋手的每条发言用 `SpeechSynthesis` 念出来,各角色用**音高/语速**区分(老炮儿低沉、教练平稳、阿强尖快,见 `web/src/voice/voice-config.ts`)。
- **说话(STT)**:点 🎤 用中文说话(`webkitSpeechRecognition`,`zh-CN`,一次性听写)→ 识别为文字走现有 `say` → 观棋者回应。
- **🔊 开关**:一键静音;重开局自动清掉排队语音。
- **优雅降级**:浏览器不支持时按钮禁用 + 提示,不报错。

**浏览器兼容性:** Chrome / Edge 最佳(TTS + STT 都成熟)。Safari 的 STT 支持有限,Firefox 基本无 STT——已做特性检测降级,TTS 在主流浏览器都可用。

### 已知简化项

- 浏览器 TTS 音色有限,只能音高/语速区分角色,不如云端自然(升级见下)。
- STT 为「按一次说一句」的一次性听写,非持续聆听。
- web 无测试框架,语音逻辑以 typecheck + build + 浏览器手动验收为准。

### 火山云 TTS 升级路径(有语音凭证再做)

浏览器音色不够"人味"时,可切火山云 TTS 拿自然多音色。需**独立的火山「语音技术」凭证**(appid + access_token,**非 ARK LLM key**):
- 后端 `POST https://openspeech.bytedance.com/api/v1/tts`(`Authorization: Bearer;<token>`,`cluster=volcano_tts`,按 persona 映射 `voice_type`)→ 返回 base64 音频;前端把 `browser-tts.ts` 抽象成 `VoiceProvider`,加 `ServerTTS` 实现 + 来源开关。env:`VOLC_TTS_APPID`/`VOLC_TTS_TOKEN`(放 `.env`)。详见 [M3b 计划文末](docs/superpowers/plans/2026-06-20-m3b-voice.md)。
