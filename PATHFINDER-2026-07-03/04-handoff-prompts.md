# Phase 4 — /make-plan 交接提示词

## H1 时钟子系统补完(U7,优先级最高)

```
/make-plan 补完围观象棋对局时钟子系统(参考 PATHFINDER-2026-07-03/01-flowcharts/F1F2-对局与规则.md §5-1..4)。
目标:单一 ClockManager 收口,入口 game-session.ts。
必修四点:
1. 超时判负:getClockState/结算处 remaining<=0 → finish 判负并广播 update(over,result)——现无任何 flag-fall(session:526-531)
2. 暂停真停钟:WS pause 分支(ws-server:491)接线到时钟(现 pauseClock session:536 是死代码,暂停墙钟时间被扣给人类 session:207)
3. 重启/续局恢复:ensureLoaded(session:115-167)重建 clockStates(现仅 newGame:194 写)
4. 悔棋回滚:undoLastMoves(session:579-604)同步回滚 repeatHistories/noCapturePlies(现裁决被污染);同时服务端加悔棋次数上限(现仅前端 useState(3) PlayPage:39,可绕过)
反模式:不要引入独立时钟服务/事件总线;不要为 AI 侧钟造假计时——若不给 AI 走钟,就在 clockState 里显式标注并让前端隐藏。
验收:超时真判负;暂停 60s 后 resume 人类剩余时间不变;重启后续局钟面正确;undo 后三次重复裁决正确。
```

## H2 反思幂等与名册单真源(U1)

```
/make-plan 修复围观象棋反思子系统的双真源缺陷(参考 01-flowcharts/F9F11 §2、F4 §4)。
1. ws-server.ts:205 spectators() 改用 cfg.personas().filter(!isPlayer)(尊重 enabled;静态 PERSONAS 仅播种用)
2. reflection/judge 降级对称:surreal-memory-store.ts:101 judgeMemory 调用套 try/catch,失败按 keep 落库(现抛错=记忆丢条;parseJudge 解析失败已是 keep)
3. deleteGame 级联 Surreal:MemoryStore 增 removeByGame(gameId),admin-routes.ts:131 删局时调用(现记忆 game_id 永久悬挂)
验收:禁用任一角色后局末反思一次成功且 reflectedGames 正确标记;删局后 Surreal 无该局记忆。
```

## H3 导出/导入保真(F10)

```
/make-plan 修复围观象棋棋谱导出/导入往返有损(参考 01-flowcharts/F10F12 §4-1)。
GameExport(game-export.ts:13)补 humanSide/endedAt/moves[].scoreCp/moves[].byAi;导入(ws-server:719-766)尊重 humanSide(现硬编码 red :742——执黑局损坏)与原始时间戳(现 now() 覆盖 :739);validateImport 补 mode 枚举校验(现任意串默认 coach :81)。
可选:导入成功后提示"可到分析页诊断"(导入局现永无成长数据,除非手动诊断)。
前端补导入 UI(现 POST /games/import 为孤儿端点,零调用者)。
验收:执黑局导出→导入→复盘,行棋方向/时间/AI标记全保真。
```

## H4 语音资源与静音语义(F7F8)

```
/make-plan 修复围观象棋 TTS 两处运行缺陷(参考 01-flowcharts/F7F8 §3.5、§4-2/5)。
1. static/tts/*.wav 清理:合成后播放完即可删;实现启动清扫+按局清理或 TTL(现零清理,实证 40MB 无界增长 moss-tts.ts:63/74)
2. 静音硬停:setMuted(true) 时联动 stopVoice()(现只停浏览器兜底,server-tts 已入队 wav 继续播 browser-tts:35 vs server-tts:106-141)
3. 损坏 wav 兜底:audio onerror 走 browserSpeak(现静默无声 server-tts:132)
验收:点静音立即无声;播放目录不随对局无限膨胀。
```

## H5 死值清理与控制台真实性(F9F11+矩阵)

```
/make-plan 围观象棋配置面与死值清理(参考 01-flowcharts/F9F11 §3a、FX-数据闭环矩阵)。
1. 控制台三个空操作旋钮:ParamsTab DirectorSection 按 mode 只渲染被消费的字段(coach:targetBand/maxDropCp;humanlike:strength)
2. 删 DEFAULTS.engine.pikafishPath 全链(defaults/validate/admin note——env 才是真源,现提示误导);控制台补 clockInitialSeconds/clockIncrementSeconds 输入(后端已消费,前端类型缺字段 admin.ts:20)
3. 清死配置:.env 的 DASHSCOPE_TTS_ENDPOINT/DASHSCOPE_TTS_MODEL/DASHSCOPE_MODEL;删 VolcanoLLM+ARK_*(或接入 buildInnerLlm 使可达)
4. 死列处置(二选一并写 ADR):growth_metrics 六列(human_side/opening|midgame|endgame_acpl/mistakes/result)要么前端消费(阶段 ACPL 折线/胜率)要么停写;messages.role 停写;drill_attempts 补 FK
5. ParamsTab 保存时对被钳制字段给出显式提示(现静默改值)
```

## H6 复盘端点合一 + 索引(U5/F10)

```
/make-plan 围观象棋读路径整备。
1. GET /games/:id 支持 ?include=annotations(合并 :544 与 :574 两端点重复查询);ReviewPage/AnalysisPage 改调
2. 补索引:move_annotations(side,theme)、games(result,ended_at)——recentResults 是每步 buildContext 热路径(games-repo:77 现全表扫)
3. sparring 执黑修复:PlayPage 陪练模式跳过"黑方自动 AI 先手"启发(ws-server:433 只对标准开局成立;现执黑陪练必弹伪错误 error 帧)
```
