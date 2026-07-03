# 全库数据字段生产/消费矩阵(横切审计)

> 四域:A=SQLite 8 表;B=Surreal memory;C=WS 帧;D=config/env/localStorage。判定:✅闭环 / ⚠️写而不读 / ⚠️条件性断链。

## A · SQLite(仅列⚠️项,其余 ✅)

| 表.列 | 生产 | 判定 |
|---|---|---|
| moves.score_cp | 仅 AI 手(session:280) | ⚠️条件性:人手/导入恒 null;唯一读者 undo prevRedCp:601 |
| moves.ply | addMove COALESCE MAX+1 | ⚠️session 用 getMoves().length 重算不读列 |
| move_annotations.* | — | 全 ✅ |
| growth_metrics.human_side/opening_acpl/midgame_acpl/endgame_acpl/mistakes/result | diagnose:100-109 | ⚠️六列写而未读(仅 mapGrowth 透传,无 UI/逻辑) |
| drill_attempts.ply/chosen_move/created_at | training-repo:21 | ⚠️写而不读(只 COUNT/SUM correct);表无 FK |
| messages.role | ws-server:140 | ⚠️实质死列(前端用 personaId==='human') |
| messages.addressee | ws-server:143 | ⚠️条件性:live 帧消费 ✅,持久列回放不读 |
| app_settings.updated_at / persona_config.updated_at | setSection/seed | ⚠️写而不读 |

## B · Surreal memory

| 字段 | 判定 |
|---|---|
| persona_id/kind/content/importance/created_at/superseded_at(状态)/embedding | ✅ |
| game_id | ⚠️写而不查(无 WHERE;MemoryTab 不渲染;deleteGame 不清→悬挂) |
| superseded_at 时间戳值 | ⚠️仅 MemoryTab 删除线,且默认 list 排除已作废=死代码 |
| embedding(episode) | 永不写(:93)→ episode 对 KNN 不可见 |

## C · WS 帧

Server→Client 6 型字段对齐 ✅;**chat.gameId/draw_response.gameId/undo_result.gameId 客户端丢弃** ⚠️。Client→Server 9 型全闭环 ✅(但无 ClientMsg 编译期类型)。

## D · Config/env/localStorage

| 项 | 判定 |
|---|---|
| chat 9/director(见 F9F11 死 3)/engine(pikafishPath 死)/diagnose/llm/tts | 见 F9F11 |
| DASHSCOPE_MODEL | ⚠️死(buildInnerLlm 恒传 cfg.model,env 默认永不触达) |
| DASHSCOPE_TTS_ENDPOINT / DASHSCOPE_TTS_MODEL | ⚠️死(云 TTS 残留,零读取) |
| ARK_MODEL/ARK_API_KEY/ARK_BASE_URL + VolcanoLLM | ⚠️死代码带死配置(从不实例化) |
| MOSS_TTS_* / SURREAL_* / EMBEDDING_* / PIKAFISH_PATH / DB_PATH / PORT / ASR_MODEL | ✅ |
| localStorage weiguan_muted;sessionStorage sparring 两键 | ✅闭环 |
| types:EngineLine.pv | ⚠️uci-parse:33 解析后零消费 |
| types:Stimulus.phase | ⚠️game-session 填,chat-engine 不读 |

## 特检六项结论

1. **死字段清单**:见上(SQLite 12 项 + Surreal 2 + WS 3 + env 6 + types 2)
2. **删除级联**:SQLite 5 子表+games 全覆盖 ✅ 无漏;**Surreal 记忆不清=永久悬挂**;**static/tts/*.wav 零清理=磁盘无界泄漏**(实证 22 wav 增长中)
3. **重启丢失内存态**:clockStates(ensureLoaded 不重建→续局钟静默消失);pausedGames/spectatorsOffGames(→暂停局自动恢复弹幕、静场局重新开嗓);diagnosedGames/reflectedGames(诊断 UPSERT 安全;**反思可能重复写记忆**);**undo 服务端无次数上限,刷新即重置 3 次**;lastCtx/tempo/prevRedCp 丢失影响轻
4. **env 死配置**:DASHSCOPE_MODEL、DASHSCOPE_TTS_ENDPOINT、DASHSCOPE_TTS_MODEL、ARK_*
5. **localStorage**:weiguan_muted 唯一持久键,闭环 ✅
6. **导出/导入往返丢失**:humanSide(导入硬编码 red——执黑局损坏!)、原始时间戳(now() 覆盖)、score_cp/by_ai(置 null/false)、messages/annotations/growth/drills(彻底丢失);validateImport 仅校验 result 枚举+走子合法;mode 不校验;**且前端无导入 UI(孤儿端点)**
