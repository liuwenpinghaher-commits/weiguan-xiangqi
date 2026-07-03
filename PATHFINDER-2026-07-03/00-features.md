# 围观象棋 — Feature 边界(Phase 0,已审定)

> 发现方法:codegraph + 全文精读两个路由总入口(ws-server.ts / main.tsx)+ 两个编排核心(GameSession / ChatEngine)。
> 审定备注:`director/director.ts` 是 **AI 对手强度导演**(归 F1),不是聊天导演;`types.ts`/`schema.sql` 归 F10 领域核心。

| # | Feature | 目的 | 入口(file:line) | 核心文件 | 依赖 |
|---|---|---|---|---|---|
| F1 | 对局会话与引擎核心 | 人机对弈闭环+时钟/暂停/悔棋/认负/求和/观众席/预走子 | ws-server.ts:385(WS /play);game-session.ts:81;PlayPage.tsx:19 | game-session.ts, engine/engine.ts, director/director.ts, Board.tsx, MoveList.tsx | F2,F3,F10,F11,F12 |
| F2 | 象棋规则与坐标层 | 合法着法/FEN/终局裁决/中文着法 | rules/position.ts:77 | position.ts, adjudicate.ts, describe-move.ts | —(裹 elephantops) |
| F3 | 观棋者聊天编排 | 4 观棋者加权选人/节拍限流/差异化读数/接话拉踩/冷场 | chat-engine.ts:69(onStimulus);ChatPanel.tsx:51 | chat-engine.ts, speaker-select.ts, tempo.ts, idle-policy.ts, personas.ts, engine-view.ts | F4,F9,F11 |
| F4 | 角色语义记忆 | 跨会话 fact/insight,HNSW 语义检索,LLM 裁决合并 | reflection.ts:58;surreal-memory-store.ts:43 | store.ts, surreal-memory-store.ts, memory-judge.ts, fake-memory-store.ts | F9(SurrealDB 独立于 F10) |
| F5 | 局后诊断与复盘 | 逐手 cp_loss/阶段/主题标签;复盘回放 | diagnose-game.ts:43;ws-server.ts:560,574,544 | cploss.ts, phase.ts, tags.ts, elo.ts;AnalysisPage/ReviewPage | F1,F2,F10 |
| F6 | 成长·训练·对比·陪练 | 成长曲线/弱点画像/失误训练/历史对比/专项陪练 | ws-server.ts:583-650(7 端点);GrowthPage.tsx:30;TrainingPage.tsx:10 | generate-drills.ts, compare.ts, llm-report.ts, sparring.ts, training-repo.ts, analysis-repo.ts, ScoreLine/WeaknessRadar | F2,F5,F9,F10 |
| F7 | TTS 语音输出 | 弹幕逐角色音色朗读(本地 moss),浏览器兜底 | ws-server.ts:772(GET /tts);server-tts.ts:168 | moss-tts.ts, voice-profiles.ts;browser-tts.ts, voice-config.ts | F3,F11,F12 |
| F8 | ASR 语音输入 | 麦克风中文→文字→say | ws-server.ts:797(POST /asr);use-speech-input.ts:19 | dashscope-asr.ts, asr.ts;wav.ts | F1,F9,F12 |
| F9 | LLM 供应层 | 统一 LLM/嵌入抽象,热重载,FakeLLM 占位 | mutable-llm.ts:7 | provider.ts, dashscope.ts, volcano.ts, fake.ts, embedding.ts, dashscope-embedding.ts | F11 |
| F10 | SQLite 存储层 | 8 表持久化+导出/导入+合法着法查询 | store/db.ts:10 | schema.sql, games-repo, messages-repo, analysis-repo, training-repo, settings-repo, game-export.ts, types.ts | — |
| F11 | 运行时配置与控制台 | 默认⊕DB覆盖即时生效;admin 五标签 | admin-routes.ts:19;runtime-config.ts:10;ConsolePage.tsx:20 | defaults.ts, validate.ts, mask.ts;五个 Tab, console-data.ts, api/admin.ts | F4,F9,F10 |
| F12 | Web 应用骨架 | hash 路由/WS 重连/HTTP 封装/设计系统 | main.tsx:23,104,165 | ws-client.ts, http-client.ts, config.ts, PageShell.tsx, theme.ts, use-viewport.ts | — |

## Phase 0 顺带发现的问题(直接进最终问题清单)

1. README"专项陪练已裁剪不含"与代码不符(report/sparring.ts + 端点完整存在)——README 过时
2. README 技术栈写"火山方舟/豆包"为主,实际活跃默认是百炼 DashScope(volcano 为备选)
3. README 目录仍写 `persona-memory-repo`(已删,记忆在 SurrealDB);**schema.sql 疑存 persona_memory 遗留表**(待 Phase 1 存储代理核实)
4. "导演"命名易混:director/ 目录是 AI 强度导演,聊天编排无导演文件
