# 贡献指南 / Contributing to Weiguan Xiangqi (围观象棋)

感谢你对 **围观象棋 (`weiguan-xiangqi`)** 的关注与贡献！为保障对弈规则准确性、内置/外置 UCI 引擎稳定性及开源隐私安全，请在提交代码前阅读以下规范。

## 1. 开发环境准备

- **Node.js**：`>= 20.0.0`
- **安装依赖**：
  ```bash
  npm install
  ```
- **象棋引擎说明**：
  - 仓库内置确定性 UCI 兼容象棋引擎（`server/src/engine/builtin-engine.ts`），无需手动配置原生二进制即可开箱运行完整对弈、逐手失分诊断与 Playwright E2E。
  - 若需连接原生 `Pikafish` 高强度 NNUE 引擎，可通过环境变量 `PIKAFISH_PATH=/path/to/pikafish` 指定（同目录放置 `pikafish.nnue`）。

## 2. 核心工程红线

1. **零敏感信息入库**：严禁提交任何真实 API Key（`DASHSCOPE_API_KEY`、`sk-*`）、本地 SQLite 数据库文件（`*.sqlite*`）、个人绝对路径或私有 IP。
2. **坐标体系统一**：
   - `elephantops` 内部行号为 `1..10`（红方底线为 `1`），`Pikafish` UCI 行号为 `0..9`（红方底线为 `0`）。
   - 所有跨边界着法转换必须通过 `server/src/rules/position.ts` 与 `web/src/board/Board.tsx` 的标准转换函数处理。
3. **无密钥与无二进制优雅降级**：
   - 未配置 `DASHSCOPE_API_KEY` 时，观棋角色弹幕、教练问答与语音播报必须平稳降级（离线确定性点评 + 浏览器 Web Speech 兜底），严禁抛出未捕获异常。
   - 测试与 E2E 必须在独立高端口与临时 SQLite 目录中运行，并在退出时清理全部子进程。

## 3. 提交前必跑检查清单

```bash
# 1. 全量单元与集成测试 + 前后端类型检查
npm test

# 2. 前后端生产构建
npm run build

# 3. 隔离环境 Playwright 真实业务深度 E2E
npm run test:e2e
```
