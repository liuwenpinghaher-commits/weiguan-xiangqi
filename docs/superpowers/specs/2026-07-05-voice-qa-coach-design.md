# 语音问答闭环(默认语音 + 教练结合棋局作答)设计文档

**Goal:** 让玩家用语音向"教练"提问,系统结合当前棋局与 Pikafish 引擎分析给出针对性回答(文字气泡 + TTS 念出);同时修复现有"语音识别失败"报错。

**Architecture:** 复用现有 ASR(百炼 qwen3-asr-flash)、chat-engine、Pikafish 引擎、TTS(百炼 qwen3-tts-flash)四套已有基础设施;新增一条 `coach_query` 刺激路径,把"玩家发言"从"旁观者随口接话"升级为"教练结合引擎分析认真作答",并让旁观弹幕在问答时让路。

**Tech Stack:** Node/Fastify/TypeScript(server)、React/Vite(web)、Pikafish UCI、百炼 DashScope(ASR/TTS)、chat 模型(当前 DeepSeek,与语音解耦)。

---

## 一、背景与根因(已实测坐实)

现象:点麦克风语音输入 → 前端弹"语音识别失败",`:3410/asr` 返回 500。

根因:`app_settings.llm` 段配的是 DeepSeek(`{"model":"deepseek-v4-flash","baseURL":"https://api.deepseek.com/v1"}`)。`/asr` 端点(ws-server.ts:818)用 `cfg.getLlm().apiKey/baseURL` 构造 `DashscopeAsr`——于是拿 **DeepSeek 的 key、去 DeepSeek 的服务器、请求只有百炼才有的 `qwen3-asr-flash`** → DeepSeek 报错 → 后端吞成 500 → 前端"识别失败"。

实测证据:
- 同一段真实人声 wav,**直连百炼成功、走后端(拿 DeepSeek 凭据)500,所有音频格式(wav/mp3/webm/ogg/m4a)全 500**。
- 后端 `/tts` 200(用独立 `process.env.DASHSCOPE_API_KEY`,不受影响)。
- CORS preflight 正常;前端转码(wav.ts)、音频格式均无问题——一度怀疑转码是被错误表名 `settings`(实为 `app_settings`)带偏,查对后推翻。

结论:ASR/TTS 都是百炼专有模型,必须用百炼凭据,与 chat 模型(可换任意 provider)彻底解耦。

## 二、现状(供对照)

- 语音输入:`web/src/chat/ChatPanel.tsx` 用 `useSpeechInput`(点麦克风开始/停止)→ 识别文本 `onSay(text)` → `PlayPage` 发 `{type:'say'}`。文字框与麦克风并存。
- 服务端 `say` 处理(ws-server.ts:452-477):落库 + 回显 + 触发 `human_said` 刺激。
- `human_said` 在 chat-engine.ts:279-281 的 prompt 是"回他一句,口语自然"——旁观者随口接话,**既不看局面细节、也不针对问题作答**。
- 引擎分析基础设施已存在:`EngineLike.analyze(fen, {multipv, movetime?, depth?}): Promise<EngineLine[]>`(ws-server.ts:38);`describeMoveZh(fenBefore, move)`(rules/describe-move.ts:44);`repo.getMoves(gameId)` 取 `fenAfter`。

## 三、数据流(目标)

```
点麦克风说话 → 录音 → POST /asr(百炼凭据) → 问题文本
  → ws {say} → 服务端 say 处理:
       ① currentFen = getMoves 最新 fenAfter(无则 game.startFen)
       ② engine.analyze(currentFen,{multipv:1,movetime}) → EngineLine[0]
          (失败/超时 → engineInsight=null,降级)
       ③ 组 coach_query 刺激(humanText + engineInsight) → chat.onStimulus
          —— 不再触发 human_said(旁观让路)
  → chat-engine:仅 coach 结合引擎分析作答 → emit chat(coach, addressee:human)
  → 前端 ChatPanel:清在途旧弹幕 → 气泡显示 + TTS 念出
```

## 四、组件设计(各单一职责)

### 组件 1:ASR 凭据解耦(修复报错) — server
- 文件:`server/src/ws-server.ts`(/asr 端点,约 809-827)。
- 改动:`asr = new DashscopeAsr(process.env.ASR_MODEL ?? 'qwen3-asr-flash', DASHSCOPE_API_KEY, DASHSCOPE_BASE_URL)`,凭据取 `process.env.DASHSCOPE_API_KEY`/`process.env.DASHSCOPE_BASE_URL`(与 /tts 一致),**不再用 `cfg.getLlm()`**。
- 缺凭据 → 503;`transcribe` 抛错 → 500 且 `req.log.error(e)` 记真实原因;识别为空 → 200 `{text:''}`(前端已处理为"没听清")。
- 保留 `opts.asr` 注入(测试用 FakeAsr)。

### 组件 2:局面分析取数 — server
- 文件:新增 `server/src/analysis/position-insight.ts`(小函数,单一职责),或在 say 处理内联(视复杂度)。
- 输入:`engine`、`currentFen`、`movetime`。
- 逻辑:`analyze(currentFen,{multipv:1,movetime})` → 取 `EngineLine[0]`:
  - `evalCp`:`line.scoreCp` 是**走子方视角**,转为**红方视角**(与 Stimulus.scoreCp 口径一致):currentFen 走子方为 black 时取 `-scoreCp`。⚠ 此视角转换是重点(buildNarrative 曾在此踩坑)。
  - `bestMoveZh`:`describeMoveZh(currentFen, line.move)`。
  - `pvZh`:沿 `line.pv` 逐手 `Position.applyMove` 推进 FEN 并 `describeMoveZh`,取前 3 手(失败即止,可空)。
  - `mate`:红方视角——黑方走子时取 `-line.mate`(与 evalCp 一致:正=红方可杀,负=黑方可杀)。
- 超时/异常 → 返回 `null`(降级)。

### 组件 3:coach_query 刺激类型 — server
- 文件:`server/src/types.ts`。
- `StimulusKind` 新增 `'coach_query'`。
- `Stimulus` 新增可选字段:
  ```ts
  /** coach_query 时:当前局面的引擎洞察(降级时为 null) */
  engineInsight?: {
    evalCp: number | null   // 红方视角厘兵分
    bestMoveZh: string | null
    pvZh: string[]          // 变例中文,前 3 手,可空
    mate: number | null
  } | null
  ```

### 组件 4:服务端 say 处理改造 — server
- 文件:`server/src/ws-server.ts`(452-477)。
- 保留:落库 `messages.addMessage` + 回显 echo。
- 改动:`spectatorsOffGames` 未关闭时,**不再触发 `human_said`**,改为:
  1. 调组件 2 取 `engineInsight`(await,带超时)。
  2. `chat.onStimulus({ kind:'coach_query', gameId, scoreCp:engineInsight?.evalCp ?? null, humanText:text, engineInsight, tension: cfg.humanSaidTension })`。
- 观众席关闭时:同现状,仅回显+落库,不触发任何刺激。
- 副作用清理:say 改触发 coach_query 后,`human_said` 不再有触发点,chat-engine 对应分支(279-281)成死代码 → plan 阶段从 `StimulusKind` 移除 `human_said` 并删该分支及 96/136 处引用(idle/turning_point 等其他刺激不受影响)。
- 说明:语音与文字框都经 `onSay` 发 `say`,故打字提问同样走 coach_query(旁观让路),语义一致。

### 组件 5:chat-engine 教练问答分支 — server
- 文件:`server/src/chat/chat-engine.ts`。
- `handleStimulus`:`kind==='coach_query'` 时,**speakers 固定为 `['coach']`**(跳过 pickSpeakers 与 player 附和逻辑)——实现"旁观让路"。若 coach persona 不存在则回退取第一个非 player 角色。
- coach_query 须纳入"重要刺激不丢弃"(不进 onStimulus:96 的高频丢旧窗口),保证玩家提问必被处理;且**不触发 player(老黑)插话**(不进 136 的 playerChime 条件)。
- `plan()` 新增 `coach_query` 分支,prompt(coach persona):
  > 玩家问你:"{humanText}"。当前局面引擎判断:红方{evalCp 转"领先/落后 N 分"或"均势"};最佳应着「{bestMoveZh}」;后续变例「{pvZh join}」{mate 时按正负补"红方 N 步杀"或"黑方 N 步杀"}。结合这些针对性回答他的问题,要专业、有据、口语,别长篇,可引一句棋理。
  - `engineInsight` 为 null(降级):prompt 去掉引擎段,改"就当前局面凭你的棋力回答"。
  - `addressee='human'`。
- token 上限沿用现有(coach 回答可略长于弹幕,但仍受 maxTokens 约束;具体值 plan 阶段定)。

### 组件 6:前端默认语音 + 让路 — web
- 文件:`web/src/chat/ChatPanel.tsx`、`web/src/pages/PlayPage.tsx`。
- 麦克风设为**默认显著输入入口**(点击开始/停止,交互不变),文字框保留为次要。
- 玩家提问(onSay,尤其语音来源)时调用 `dropQueued()`(server-tts.ts 已有)清在途旧弹幕,让教练回答优先播报——"让路"的前端部分。
- 教练回答走现有 chat 气泡渲染 + TTS 通道(personaId=coach),无需新组件。

## 五、旁观让路机制(汇总)

- 服务端:玩家提问只触发 `coach_query` → chat-engine 只让 coach 作答,不触发其他旁观者。
- 前端:提问时 `dropQueued()` 清掉没播完的旧弹幕。
- 效果:玩家一提问,弹幕停/不新增,只教练结合棋局回答;答完,后续走子/idle 等刺激旁观照常恢复。

## 六、错误处理与降级

- ASR 凭据缺失 → 503("未配置");识别空 → "没听清";真异常 → 500(日志留真因)。
- Pikafish 分析失败/超时 → `engineInsight=null` → 教练纯 LLM 作答,不阻断。
- chat LLM / TTS 失败 → 各自兜底(沿用现有),不影响对局与落库。

## 七、测试策略(TDD)

- **ASR 凭据解耦回归**:构造 `app_settings.llm=DeepSeek` 场景,断言 `/asr` 仍用 `DASHSCOPE_API_KEY`(注入 FakeAsr 校验传入凭据/或校验不读 getLlm)。防"串回 chat 模型"。
- **局面分析取数**:给定 fen + Fake 引擎返回 → 断言 evalCp 红方视角转换正确(黑方走子时取负)、bestMoveZh 非空;引擎抛错 → 返回 null。
- **say → coach_query**:玩家发言 → 断言触发的是 `coach_query`(非 `human_said`)且带 engineInsight。
- **chat-engine coach_query**:①speakers 只含 coach(旁观让路);②plan prompt 含 humanText + 引擎数据;③engineInsight=null 时走降级 prompt。
- **前端**:onSay 触发 dropQueued(既有测试模式)。

## 八、YAGNI 边界(不做)

- 不改录音格式、不重写前端转码(转码本无问题,报错是凭据)。
- 不做常听/VAD;不做问题类型智能路由(每次都接引擎,简单可靠)。
- 不新增"助手"角色(复用 coach);不做多轮对话记忆(单问单答,后续可加)。
- "旁观让路"不设可配开关(直接让路,是既定行为)。

## 九、涉及文件清单

| 文件 | 改动 |
|---|---|
| `server/src/ws-server.ts` | /asr 凭据解耦;say 处理改触发 coach_query |
| `server/src/types.ts` | StimulusKind +coach_query;Stimulus +engineInsight |
| `server/src/analysis/position-insight.ts` | 新增:当前局面引擎洞察取数(视角转换 + 中文着法) |
| `server/src/chat/chat-engine.ts` | coach_query:仅 coach 发言 + 结合引擎的 prompt 分支 |
| `web/src/chat/ChatPanel.tsx` | 麦克风默认显著入口 |
| `web/src/pages/PlayPage.tsx` | onSay 时 dropQueued 让路 |
| 对应 `*.test.ts` | 上述各单元测试 |
