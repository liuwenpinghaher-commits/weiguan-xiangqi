# 安全策略 / Security Policy

## 支持版本 / Supported Versions

| 版本 | 支持状态 |
| :--- | :---: |
| `main` (最新主干) | ✅ 支持 |

## 核心安全机制

1. **凭据隔离与脱敏回显**：
   - API 密钥（`DASHSCOPE_API_KEY`、`EMBEDDING_API_KEY`）仅保存在服务端环境变量或本地不受版本控制的 SQLite 设置表中。
   - 控制台配置接口默认掩码返回密钥（`mask.ts`），且管理端路由（`/admin/*`、`/games/import`）严格限制本机回环地址（`127.0.0.1` / `::1`）访问。
2. **跨站 WebSocket 劫持 (CSWSH) 与成本接口防护**：
   - WebSocket `/play` 与 `/tts` 接口强制校验 `Origin` 白名单（默认仅放行本地前端 `:3420` 及 `FRONTEND_ORIGINS` 显式配置源），防止恶意网页跨域消耗 LLM/TTS 配额。
3. **优雅关闭与进程隔离**：
   - 服务端监听 `SIGINT` / `SIGTERM`，退出时自动释放 UCI 引擎子进程并完成 SQLite WAL Checkpoint。

## 报告安全漏洞 / Reporting a Vulnerability

如发现潜在安全问题，请勿在公开 Issue 中直接披露利用细节，请通过 GitHub Security Advisories 私密提交报告。我们将在 72 小时内响应并跟进修复。
