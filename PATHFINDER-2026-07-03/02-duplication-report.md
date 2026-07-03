# Phase 2 — 重复关注点与双真源报告

> 编排者综合。证据来自 01-flowcharts/ 八份报告,每项 ≥2 处 file:line。
> 判定:【意外分叉】=应统一;【合理特化】=保留。

## D1【意外分叉·高危】persona 名册双真源:静态 PERSONAS vs cfg.personas()
- 位置A:`personas/personas.ts:26` `spectators`(静态,无视 enabled)— 被反思触发用 `ws-server.ts:205`
- 位置B:`runtime-config.ts:64-66` `personas()`(DB 合并,按 enabled 过滤)— 被聊天用 `chat-engine.ts:86,103`
- 为何分叉:控制台改造时聊天迁到 cfg,反思漏迁
- 后果:禁用角色 → reflect 内 `cfg.getPersona(disabledId)` throw(runtime-config:74)→ Promise.all 整体 reject → reflectedGames 不标记 → **反思无限重跑+记忆重复写**
- 统一:反思也走 `cfg.personas().filter(p=>!p.isPlayer)`;静态 PERSONAS 仅作播种种子

## D2【意外分叉·高危】配置双真源:env vs RuntimeConfig
- pikafishPath:env `PIKAFISH_PATH`(index.ts:3,真)vs `DEFAULTS.engine.pikafishPath`(defaults:28,假——validate:51 清洗、admin 暴露、ParamsTab 提示,但 spawn 永不读)
- embedding 凭据:boot 期 env 构造(dashscope-embedding:17-18,不热更)vs LLM/ASR 走 cfg.getLlm()(热更)——三套凭据行为不一致
- 统一:引擎路径要么从 cfg 读(重启生效)要么从控制台删掉;embedding 构造改从 cfg 取并挂 onLlmChange

## D3【意外分叉】两套 FEN 解析器
- `rules/position.ts:83`(elephantops 包装)vs `rules/describe-move.ts:9`(自带 parseBoard)
- 为何分叉:describeMoveZh 只需棋盘布局,当初图省事独立解析;历史坑 OPEN-ISSUES #1 即源于两套坐标约定
- 统一:describeMoveZh 接受 Position 或复用其解析;至少共享一个 parseFen

## D4【意外分叉】弹幕双写:SQLite messages + Surreal episode
- `ws-server.ts:137`(messages 落库,回放消费)与 `chat-engine.ts:145-152`(episode 写 Surreal,**无人读**:retrieve 只取 fact/insight chat-engine:190)
- 统一:删 episode 写入(或给它真实消费方);回放/审计走 messages 单源

## D5【意外分叉】复盘数据端点冗余
- `GET /games/:id`(ws-server:544,game+moves+messages)vs `GET /games/:id/diagnosis`(:574,game+moves+annotations)
- 两端点各查一遍 game+moves,互不为超集;ReviewPage/AnalysisPage 各拉一趟
- 统一:一个端点 `?include=messages,annotations` 或合并返回

## D6【部分合理特化】双层 TTS 背压
- server-tts 队列丢最旧(server-tts:187-190)+ browser-tts pendingCount>2 全清(browser-tts:55)
- 特化理由:两条播放通道特性不同;但阈值/策略无共享常量,回退时连续两次丢弃的复合行为无人设计过 → 建议至少共享策略常量并在回退路径豁免二次丢弃

## D7【意外分叉】双 SQLite 物理文件
- `DB_PATH ?? './weiguan.sqlite'`(index.ts:8)随 CWD 漂移:根目录陈旧库(4KB+103KB 未 checkpoint WAL)vs server/ 活跃库(磁盘实证)
- 统一:默认路径锚定 `import.meta.dirname` 或强制绝对路径

## D8【合理特化·保留】FakeLLM/FakeAsr/FakeMemoryStore/FakeEmbedding
四个 Fake 双胞胎服务测试与降级,是有意设计。保留;但降级发生时应有可见信号(见问题清单)。

## D9【意外残留】云 TTS/火山 LLM 死残留
- `VolcanoLLM`(volcano.ts:5,零实例化)+ `ARK_*` env;`DASHSCOPE_TTS_ENDPOINT/MODEL`(.env,零读取);web `VOICE_PARAMS` 注释自陈临时(仅兜底存活,保留但注明)
- 统一:删 VolcanoLLM 或在 buildInnerLlm 加分支使其可达;清 .env 死键
