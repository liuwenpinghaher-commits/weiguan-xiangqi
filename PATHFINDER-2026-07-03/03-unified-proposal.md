# Phase 3 — 统一提案(编排者综合)

> 原则:删除优先于抽象;单路径优先于可配置路径。每项列出旧调用点去向与能力损失评估。

## U1 名册单真源(修 D1,连带修"禁用角色毒化反思")
- 组件:`RuntimeConfig.spectators()`(新增,= personas().filter(!isPlayer))
- 旧调用点:`ws-server.ts:205` 的 `spectators()`(静态导入)→ 改调 cfg;`personas.ts:26` 保留仅供播种
- 能力损失:无。副作用修复:反思幂等恢复

## U2 配置单真源(修 D2)
- 引擎路径:删 `DEFAULTS.engine.pikafishPath` + validate + ParamsTab note(**删除优先**——env 已是事实真源);或反向:index.ts 改读 cfg(需重启提示才成立)。推荐删除。
- embedding:`buildEmbedding(cfg)` 挂 `onLlmChange`,与 MutableLLM 同生命周期
- 旧调用点:index.ts:3 不变;dashscope-embedding 构造点 ws-server:~100 改传 cfg 值
- 能力损失:无

## U3 FEN 解析统一(修 D3)
- `describeMoveZh(pos: Position, move)` 或内部 `Position.fromFen(fen).board()`;删 describe-move.ts:9 的 parseBoard
- 旧调用点:session:73 safeDescribeMove、ws-server:193 doReflectGame(均已持有 fen,可构造 Position)
- 能力损失:无(性能差异毫秒级)

## U4 弹幕单写(修 D4)
- 删 `chat-engine.ts:144-155` episode record;admin MemoryTab 的"片段"筛选项随删
- 能力损失:admin 里浏览 episode 的能力 → 由 GamesTab 消息查看(messages 表)完全覆盖
- 若未来要"聊天氛围记忆",在反思阶段聚合生成 insight,而非逐句 episode

## U5 复盘端点合一(修 D5)
- `GET /games/:id?include=messages,annotations`;两页面各取所需
- 旧调用点:ReviewPage:41、AnalysisPage:21/27、GamesTab:17
- 能力损失:无

## U6 数据库路径锚定(修 D7)
- `DB_PATH ?? join(import.meta.dirname,'..','weiguan.sqlite')`;启动日志打印绝对路径
- 收尾:根目录陈旧 weiguan.sqlite* 三件套归档或删除(需用户确认——含 6-20 数据)

## U7 时钟子系统补完(修 F1 四连:超时/AI侧/暂停/持久)
这不是重复,是**半成品统一收口**。单入口 `ClockManager`:
- move 时结算 + 超时判负(remaining<=0 → finish('flag'))
- pause/resume 真正停钟(ws pause 分支调用,删死代码 pauseClock 或接线)
- 快照进 moves 行(可选列 red_ms/black_ms)或 games 终局快照,复盘可见
- AI 侧钟:AI 应手计时或明示"AI 不走钟"并在 UI 隐藏黑方钟
- 能力损失:无;新增判负规则需产品确认(默认开,可配)

## 全局统一架构图(目标态)

```mermaid
flowchart TD
    subgraph 前端[Web 前端 :3420]
        PLAY[PlayPage 对局] --- CHATP[ChatPanel 弹幕+TTS队列]
        REV[Review/Analysis 合一数据源] --- GROW[Growth/Training]
        CONS[Console 五标签]
    end
    subgraph 传输[契约层]
        WSC[ws-client ServerMsg+**ClientMsg**] 
        HTTPC[http-client/admin]
    end
    subgraph 后端[Fastify :3410]
        WSS[ws-server 路由/门控]
        SESS[GameSession+**ClockManager(U7)**]
        DIR[director 分带]
        CHAT[ChatEngine tempo/select/plan]
        REFL[reflection→**cfg.spectators()(U1)**]
        DIAG[diagnoseGame]
        VOICE[/tts moss-tts + /asr dashscope/]
        ADMIN[admin-routes loopback]
        CFG[RuntimeConfig 单真源(U2)]
    end
    subgraph 引擎与模型
        PIKA[[pikafish UCI]]
        MOSS[[moss-tts-nano :18083]]
        LLM[MutableLLM→DashScope]
        EMB[Embedding(挂 onLlmChange U2)]
    end
    subgraph 存储
        SQL[(SQLite 锚定路径(U6)\ngames/moves/messages(单写 U4)/annotations/growth/drills/settings/personas)]
        SUR[(Surreal memory\nfact/insight,级联清理)]
        STATIC[(static/tts wav\n+TTL 清理)]
    end
    PLAY<-->WSC<-->WSS
    前端-->HTTPC-->WSS & ADMIN
    WSS-->SESS-->PIKA
    SESS-->DIR
    WSS-->CHAT-->LLM
    CHAT-->SUR
    WSS-->REFL-->LLM & SUR
    WSS-->DIAG-->PIKA
    VOICE-->MOSS
    WSS & CHAT & SESS & DIAG & VOICE-->CFG
    ADMIN-->CFG-->SQL
    SESS & CHAT & DIAG-->SQL
    EMB---SUR
```

反模式自查:未新增抽象层(ClockManager 是收口既有散落逻辑非新框架);无 feature flag 保双路径;无 registry/factory。
