# 围观象棋 · 语音输入(服务端 ASR)设计

- 日期:2026-06-21
- 状态:已与用户确认设计,待写实现计划
- 一句话:把"用户用麦克风说话"的语音输入从**浏览器 `webkitSpeechRecognition`(依赖 Google,大陆不可达)**换成**服务端 ASR**——前端一次性录音 → `POST /asr` → 后端调阿里云 DashScope ASR → 返回文字 → 直接当作发言发送。

## 背景(为何要做)

调试发现"用户语音不能用"是两个问题:
1. **(已修,commit f0c51d3)** `say` 处理器漏广播,用户自己的话不回显到聊天框 → 已补 `chat` 帧广播。
2. **(本设计)** 语音输入纯靠浏览器 `webkitSpeechRecognition`,它把音频发给 Google 语音服务器识别,大陆网络连不上 → 麦克风"聆听"但识别静默返回空、`onSay` 从不触发。**服务端无任何 ASR 能力。**

对比:听角色说话(TTS)走自己的后端 → 阿里云 DashScope(qwen3-tts-flash),国内可达、工作正常。所以解法是让语音**输入**也走阿里云这条已验证通路。

## 用户已确认的关键决策

1. **交互/架构**:**一次性录一段**——点麦克风开始录、再点停止 → 录到的音频整段 POST 给后端一次性识别。**不做**实时流式(WebSocket 边说边出字)。
2. **转写去向**:**直接发送**——识别出的文字立即当作发言发出(走现有 `onSay`),不填输入框等确认。聊天容错高,可接受偶发识别错。
3. **旧 STT**:**完全替换**——删除 `use-speech-input.ts` 里的 `webkitSpeechRecognition` 路径,麦克风按钮改走服务端 ASR。

## 不在范围(YAGNI)

实时流式 ASR;识别结果填输入框校对;多语言切换;说话人分离;保留浏览器 STT 作降级(其在目标网络环境本就不可用,留着只添乱)。

## 架构与数据流

```
[麦克风按钮] 点击开始
  → navigator.mediaDevices.getUserMedia({audio})
  → MediaRecorder 录音(默认 audio/webm;codecs=opus)
点击停止
  → 得到 Blob(audio/webm)
  → POST /asr  (body = 音频二进制, header Content-Type = blob.type)
后端 /asr
  → AsrProvider.transcribe(buffer, mimeType) → text
  → 返回 { text }
前端
  → 非空 text → onSay(text)  → WS {type:'say'} → 服务端回显+喂AI(问题1链路已通)
  → 空 text → 不发送,提示"没听清,再说一次"
```

复用现有 DASHSCOPE 凭据(`cfg.getLlm().apiKey` / baseURL,控制台可配)。

## 组件边界(仿已验证的 LLMProvider / EmbeddingProvider 模式)

### 1. `AsrProvider` 接口 + `FakeAsr`
`server/src/voice/asr.ts`:
```ts
export interface AsrProvider {
  /** 把整段音频转写为文字;失败抛错 */
  transcribe(audio: Buffer, mimeType: string): Promise<string>
}
```
`FakeAsr`:构造时给定要返回的文字(或一个 `(audio,mime)=>string` 函数),供路由/前端联调测试,不打网络。

### 2. `DashscopeAsr`
`server/src/voice/dashscope-asr.ts`:实现 `AsrProvider`,调用阿里云 DashScope ASR。
- 凭据从构造参数注入(apiKey/baseURL/model),与 `DashscopeEmbedding` 一致;client 可注入以便测试不打网络。
- **模型/端点/音频格式实现时核对 DashScope 文档**(见"风险")。

### 3. `POST /asr` 路由
`server/src/ws-server.ts`(或同级单独路由文件)新增:
- 接收二进制音频 body(Fastify 需为对应 content-type 注册 raw body parser,或用 `application/octet-stream`)。
- 无 DASHSCOPE key → 503(与 `/tts` 一致)。
- 调 `asr.transcribe(buf, contentType)` → `{ text }`;识别失败 → 500 带错误信息。
- 体积/时长上限(如 ≤ 2MB / 提示前端限 60s)防滥用。

### 4. 前端 `use-speech-input.ts` 重写
- 保留对外接口形状 `{ listening, start, stop, supported, error }`,让 `ChatPanel` 改动最小。
- `supported = typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder`。
- `start()`:getUserMedia → new MediaRecorder → 收集 chunks → `listening=true`。
- `stop()`:recorder.stop → onstop 合并 Blob → fetch POST `/asr` → 拿 text → `onResult(text)`(=现有 `onSay`)→ `listening=false`。
- `error`:getUserMedia 拒绝 → `'not-allowed'`;/asr 失败 → `'asr-failed'`/网络;空文本 → `'no-speech'`。复用 ChatPanel 现有错误提示文案(微调措辞)。
- 删除 `webkitSpeechRecognition` 相关全部代码。
- `web/src/api/config.ts` 加 `asrUrl()`(或直接 `${HTTP_BASE}/asr`)。

## 错误处理矩阵

- 浏览器不支持 MediaRecorder/getUserMedia → 按钮置灰(`supported=false`),提示"浏览器不支持录音"。
- 麦克风权限被拒 → `not-allowed` → "麦克风权限被拒,请在浏览器设置中允许"。
- `/asr` 503(无 key)→ 提示"未配置语音识别(DASHSCOPE_API_KEY)"。
- `/asr` 网络/服务错 → "语音识别失败,请重试"。
- 识别空文本 → 不发送,提示"没听清,再说一次"。

## 测试策略

- **`FakeAsr`**(单测):构造返回固定文字,transcribe 返回它。
- **`/asr` 路由**(集成,app.inject):POST 一段假音频字节 + content-type → 注入 `FakeAsr` 的 server → 返回 `{text}`;无 key → 503;空音频/识别空 → 相应处理。
- **`DashscopeAsr`**(单测):注入假 client(不打网络),验证它按约定组装请求并解析响应映射为文字(仿 `dashscope-embedding.test.ts`)。
- **前端**:`use-speech-input` 的纯逻辑(`supported` 判断、错误码→文案映射)可 vitest(node 环境);MediaRecorder/getUserMedia 录音部分走 typecheck+build + 手动目检(node 环境无法测 DOM 媒体 API)。
- 既有 275 server + 28 web 测试不破;`buildServer` 需能注入 `opts.asr`(测试用 FakeAsr),仿现有 `opts.llm`。

## 风险与权衡

- **⚠️ 最大不确定点:DashScope ASR 的确切模型 + 端点 + 接受的音频格式。** 候选:`qwen3-asr-flash`(与已用的 qwen3-tts-flash 同族多模态生成端点)或 `paraformer` 系列。关键是**是否接受 MediaRecorder 产出的 `audio/webm;codecs=opus`**:
  - 若接受 opus/webm → 前端直接发录到的 Blob,最简单。
  - 若只接受 wav/mp3/pcm → 方案 A 前端改用 Web Audio API 录 PCM/WAV;方案 B 选支持 opus 的模型/端点。
  - **实现计划里单列"对照 DashScope 文档核实模型/端点/格式 + 真实音频冒烟"步骤**(类比之前 SurrealQL 对 v3.1.5 的核实),不凭空写 API。
- **自动发送 + 识别错**:用户已选直接发送,错字会进对话;聊天场景容错高,可接受。
- **费用**:每次识别真打阿里云 ASR,产生费用(用户已知悉)。仅本机单人、低频,可控。
- **隐私**:音频上传到阿里云识别,与 TTS 同信任级别(同一 DASHSCOPE 账户)。
