# F9 LLM 供应层 + F11 运行时配置与控制台 — Phase 1

## Sources(要点)
llm/{provider,mutable-llm,dashscope,volcano,fake,embedding,dashscope-embedding}.ts;config/{defaults:1-35,runtime-config:9-111,validate:3-68};admin/{admin-routes:19-134,mask:2-10};settings-repo:9-68;schema.sql:79-96;console 五 Tab+console-data;api/admin.ts;全消费点(ws-server/chat-engine/game-session/director/diagnose/reflection/memory-judge/llm-report/moss-tts)。

## 图①配置读写环(要点)
DEFAULTS ⊕ app_settings → merged() 每读合并即时生效;PUT /admin/config/:section → validateSection 钳制 → setSection UPSERT → section∈{llm,tts} 时 onLlmChange → MutableLLM.replace;保存后 ConsolePage version++ → personas/keys/params 三 Tab key 重挂载回填钳后值(memory/games 不带 key)。

## 图②LLM 调用面(要点)
buildInnerLlm:apiKey&&baseURL→DashscopeLLM 否则 FakeLLM(chat 恒返'');VolcanoLLM 仅测试注入可达=生产死代码。4 个调用方:chat-engine:110(70tok)/reflection:68(200)/memory-judge:26(120)/llm-report:27(300)。withLLMRetry [300,800] 仅 429/5xx。降级链:弹幕跳过/反思不写/judge keep/报告回退规则 summary。**disableThinking 在 DashscopeLLM 被忽略(:58)=生产死开关**。

## 字段审计结论

**chat 9 字段全消费 ✅;diagnose.depth ✅;llm 3 ✅;tts 3 ✅**

**director 逐模式死字段 ⚠️**:selectCoach 只读 targetBand+maxDropCp(director:27,29);selectHumanlike 只读 strength(:46)→ **coach.strength、humanlike.maxDropCp、humanlike.targetBand 三个控制台旋钮为空操作**(ParamsTab 对两模式渲染全部 4 输入)。

**engine 段**:multipv/movetime ✅(诊断另 hardcode multipv:1);**pikafishPath 100% 死配置**(引擎实际取 env PIKAFISH_PATH index.ts:3;DB 值零读点;ParamsTab"需重启"note 误导——重启也无效);clockInitialSeconds/clockIncrementSeconds 后端消费 ✅ 但**控制台无输入且前端 EngineCfg 类型缺这两字段**(admin.ts:20)。

**admin API**:GET /admin/personas 前端零调用(死导出 getPersonas);/reveal 明文 key 有 loopback 守卫+20s 自动清;maskKey 规则完备。

## 业务闭环观察

1. **validateSection vs PARAM_FIELDS**:大部分一致;minSilenceMs/maxPerMin/idleIntervalMs 后端无上界(前端更严,方向安全);**ParamsTab.save 不校验 min/max→后端静默钳制→重挂载回填但无"已被钳制"提示**(数字悄悄变)
2. **persona enabled=false**:聊天 ✅ 尊重;**反思 ❌ 不尊重**——spectators 来自静态 PERSONAS(personas.ts:26)无视 enabled → reflect 内 cfg.getPersona(disabledId) throw → Promise.all 整体 reject → reflectedGames 不标记 → **每次触发都重跑,已成功角色的记忆重复写入**(靠 judge 归并兜底)⚠️ 禁用任一角色=毒化反思幂等;TTS 端点不设 enabled 闸(直接打 /tts 仍合成)
3. **embedding 凭据与控制台解耦**(boot 期 env 构造,改控制台 key 不影响嵌入);ASR 用 cfg 实时凭据(会跟随)——三套凭据行为不一致

## Confidence/盲区
高(全字段 grep 双向核对;死配置/死字段三重印证)。盲区:reflect 重跑的实际重复量取决于 judge 行为。
