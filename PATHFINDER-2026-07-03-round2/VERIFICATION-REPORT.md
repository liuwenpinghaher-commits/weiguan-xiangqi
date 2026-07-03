# 二次审计报告 — 50 项修复合入 main 后的闭合核验 + 回归猎取

> HEAD=312a33d。5 个核验代理并行,每项结论带 file:line。方法:对上轮 PATHFINDER-2026-07-03 每条修复做 CLOSED/PARTIAL/REGRESSED 判定 + 猎取本轮改动引入的新问题。

## 一、闭合结论

上轮 50 项修复:**绝大多数真闭合**。逐批核验:
- 对局核心 9 项:全 CLOSED(超时判负/暂停停钟/AI 走钟/续局重建/悔棋回滚+上限/startFen/求和看局面/执黑拒绝/观众席回显)
- 记忆 6 项:5 CLOSED,#6 embedding 热更 PARTIAL(见 R-3)
- 导出导入+语音 6 项:字面全 CLOSED,但 endedAt 单向丢失 + 坏 wav 兜底引入回归(见 R-1/R-4)
- 前端 10 项:9 CLOSED,aiReason 展示 PARTIAL(闭包陈旧,见 R-2)
- 配置死值 11 项:10 CLOSED,死代码清理 PARTIAL(README/​.env.example/dist 残留,见 R-6)

**净结果:功能层修复基本成立;但本轮大改动引入了 1 个 HIGH + 若干 MED/LOW 新问题,其中数个正是"修复不彻底/边角未覆盖"。**

## 二、新问题清单(本轮引入/暴露,按严重度)

### 🔴 R-1【HIGH·真回归】完局后无守卫 → 走子/悔棋复活已结束对局,写脏库
- 位置:`game-session.ts:261`(playHumanMove 无 result 守卫)、`:156-176`(ensureLoaded 的 `!g.result` 只挡时钟不挡棋盘重建)、`:338-339`(addMove×2);`ws-server.ts:480`(move 分支无守卫)
- 场景:①读秒竞态——sweeper tick 先 finish 判负删态,紧随的 move 经 checkTimeout(null)→ensureLoaded 把已完局重建为可下→追加 2 手到已判负的局;②resign/draw/timeout 完局后,客户端重试或第二连接发 move 同样复活。DB 出现"终局后还有着法",结果与着法数不一致,僵尸局可无限续下。
- 根因:本轮给 ensureLoaded 加了 DB 重建(为续局),但未加完局守卫。修复前 `positions.get→undefined→'game not found'` 会安全抛错。
- 修:playHumanMove/undoLastMoves 顶部加 `if (repo.getGame(gid)?.result) throw/return`。

### 🟠 R-2【MED·部分我引入】handleServerMsg 闭包捕获陈旧 side/mode
- 位置:`PlayPage.tsx:86,109`(side)、`:114`(mode,本轮 aiReason 新增消费);无 sideRef/modeRef(对比 gameIdRef :47)
- 场景:切执方/模式后即时重开局(handleSideChange/handleModeChange→handleRestart→connect 同步捕获切换前闭包)→ 新局整局用旧 side/mode:状态栏胜负文案反转(执黑取胜显"你输了",但醒目横幅走渲染作用域正确→自相矛盾)、MoveList AI 手执方标注错;mode 陈旧致 aiReason coach 门控反转。side 反转是既有 bug,mode 反转是本轮 aiReason 那行新引入。
- 修:引入 modeRef/sideRef,handleServerMsg 内读 ref。

### 🟠 R-3【MED·修复不彻底】embedding 初始构造仍只读 env,忽略控制台凭据
- 位置:`ws-server.ts:105` `new DashscopeEmbedding()`(无 override)
- 场景:env 无 key 但控制台配了 key → 启动即抛"缺少 KEY"→ 降级 FakeMemoryStore,且热更闭包在抛错行之前未安装 → 语义记忆整进程永久缺席,即便控制台凭据有效。修复 #6 只修了热更路径、漏了 boot 路径(注释自述要修"三套凭据不一致")。
- 修:初始行改 `const l0=cfg.getLlm(); new DashscopeEmbedding(undefined,undefined,undefined, l0.apiKey??undefined, l0.baseURL??undefined)`。

### 🟠 R-4【MED·真回归】stopVoice 期间 play() 中止被误判"坏 wav"→ 机械音复活已停句
- 位置:`server-tts.ts:129-140`(坏 wav 兜底缺 `gen!==generation` 守卫,对比 :108/:120 都有)
- 场景:某句 wav 起播中调 stopVoice()(暂停/重开局/关观众席)→ pause() 让 play() 以 AbortError 拒绝 →failed=true→ 在 stopVoice 之后 browserSpeak 用浏览器机械音把那句复活。重开局场景正是它想避免的串台从兜底漏出。静音路径侥幸安全(先 setMuted)。本轮"坏 wav 兜底"引入。
- 修:`if (failed) browserSpeak` 前加 `if (gen !== generation) break`。

### 🟠 R-5【MED·修复不彻底】endedAt 单向丢失 → recentResults 污染
- 位置:导出带 endedAt `game-export.ts:64`;validateImport 不收不还原 `:84-102`;`ws-server.ts:827 finishGame(...,now)`
- 场景:已结束的旧局导出再导入 → startedAt 保留、endedAt=导入时刻。`recentResults ORDER BY ended_at DESC`(games-repo:81)→ 旧局顶到"最近战绩"最前,污染战绩流。修复 #1/#2 给导出补了 endedAt 但导入侧未还原,round-trip 非对称。
- 修:validateImport 收 endedAt,路由 `finishGame(gid, result, endedAt ?? now)`。

### 🟡 R-6【MED 低可达 + LOW·修复不彻底】
- R-6a【MED 低可达】`game-export.ts:114` createdAt 只校验 Date.parse 不归一化 → 导入非规范时间戳(`2024/01/15`、带偏移)破坏 `started_at` 字典序 → compare 前后窗错切。自产/自导出回流不受影响。修:导入时 `new Date(createdAt).toISOString()` 归一。
- R-6b【LOW 文档】README:346-352 仍留 ARK_BASE_URL/ARK_API_KEY/ARK_MODEL(上轮只改了前置依赖处,漏了这处);.env.example 仍留 DASHSCOPE_MODEL。照 README 配 LLM 完全不工作。
- R-6c【LOW UX 回归】`TrainingPage.tsx:75-79` 全答对→drills 空→空态误报"需先诊断";stats 面板嵌在 drills.length>0 分支内不显示。本轮"排除已答对"引入。

### 🟡 R-7【MED·真回归】悔棋起钟硬编码人类方 + 无完局守卫
- 位置:`game-session.ts:697 startClockFor(humanSide)`、`:665` undoLastMoves 无 result 守卫
- 场景:人类走出将死结束的局,悔末 2 手 → 重建轮到 AI,却给人类起钟 → 人类走不了("not your turn")、悔棋不触发 aiFirstMove → 卡死,人类钟空转直至 sweeper 判超时负;且 undoCounts 因 finish 已清被绕过。正常进行中局无此问题(AI 恒最后一手)。
- 修:起钟改 `newPos.sideToMove()`;加完局守卫(与 R-1 同根)。

### 低危/INFO(择要)
- R-8【LOW-MED 安全】`/games/import` 是写操作却在 /admin loopback 守卫之外(ws-server:778);对照 /admin 删除是 loopback-only,姿态不一致。绑非 loopback 接口时远程可写库。
- R-9【LOW】ParamsTab 钳制后输入框不回填,重复保存反复提示"已调整"(本轮钳制提示引入,ParamsTab:27/56)。
- R-10【LOW】reflectedGames 在 timeout/resign/draw 完局路径从不 forgetGuards,单调增长(每局 1 int,影响有限)。
- R-11【LOW】WS new 未校验 humanSide,畸形输入(缺省/非法)→ humanSides=undefined → playHumanMove "not your turn" 恒真死局。
- INFO:mistakesPerGame 进了数据链但 summary/LLM prompt 未引用;DashscopeLLM 默认 qwen-plus vs DEFAULTS qwen-plus-latest(生产走 cfg,死值);dist/llm/volcano.js 编译残留;timeout/resign/draw 完局不自动诊断(不对称,疑有意);记忆检索无相关度地板 + isDegraded 不覆盖"连上但嵌入失败"。

## 三、核验通过(排除的疑点,非 bug)
undoRemaining 两处 setState 互斥补集(不重复扣);engine 段双 PUT 字段级合并不互覆;GrowthPage 新字段 mapGrowth 全返回;chat 4 新字段 getChat 恒有;ClientMsg 收窄后各 send 合规(tsc 0);cleanupOldTts 全同步无竞态、TTL 不误删新文件;导入 byAi 全 false 不破坏复盘/诊断(人手识别靠 side===humanSide);importGame URL 拼对;pause/resume/sweeper 基准正确;AI 走钟归属无交叉误记。

## 四、优先级建议
- 立即修:R-1(HIGH,merged main 有脏库风险)、R-2(胜负文案反转,用户可见)
- 应修:R-3/R-4/R-5/R-7(MED,多为修复不彻底/新回归)
- 择机:R-6a/b/c、R-8~R-11 + INFO
- 根因归并:R-1 与 R-7 同为"完局无守卫",一处 guard 可同时解决大半。
