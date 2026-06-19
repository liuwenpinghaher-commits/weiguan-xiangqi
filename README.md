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

**后端单元测试（vitest，28 个用例）：**

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

**后续里程碑（尚未实现）：**

- **M2**：智能分析——局面诊断、弱点画像、成长曲线。
- **M3**：AI 棋手人设、观棋者视角、长期记忆、语音交互。
