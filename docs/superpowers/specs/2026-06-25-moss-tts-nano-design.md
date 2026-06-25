# moss-tts-nano 离线 TTS 集成设计

## 目标

将现行 Dashscope 云端 TTS 替换为 moss-tts-nano 本地离线模型，利用其流式生成、采样参数调节、音色克隆等全能力，实现多角色动态情绪化语音交互。

## 架构

```
浏览器 GET /tts?personaId=X&text=Y
      ↓
Node.js Fastify (:3410)
  ├─ 查 persona voiceProfile（参考音频 + 采样参数）
  ├─ POST /api/generate-stream/start → moss-tts-nano serve (:18083)
  ├─ 轮询 GET /api/generate-stream/{id}/audio → 收 WAV 块
  ├─ 拼接为完整 WAV，写入 server/static/tts/{uuid}.wav
  └─ 返回 { url: "/static/tts/xxx.wav" }
      ↓
浏览器 <audio> 播放
```

## 数据模型

### TtsCfg（config/defaults.ts）

```ts
interface TtsCfg {
  mossNanoUrl: string           // 默认 "http://127.0.0.1:18083"
  referenceAudio: string        // 默认参考音频路径
  streaming: boolean            // 默认 true，使用流式 API
}
```

### VoiceProfile（voice/moss-tts.ts）

```ts
interface VoiceProfile {
  referenceAudio: string         // 参考音频文件路径
  textTemperature: number        // 默认 1.0
  audioTemperature: number       // 默认 0.8
  audioTopP: number              // 默认 0.95
  audioTopK: number              // 默认 25
  audioRepetitionPenalty: number // 默认 1.2
  maxNewFrames: number           // 默认 375
}
```

### 默认角色 VoiceProfile

| 角色 | 音色方向 | audioTemperature | textTemperature | 效果 |
|------|---------|-----------------|-----------------|------|
| player | 沉稳 | 0.7 | 0.8 | 冷静克制，关键时刻有张力 |
| laopaoer | 随性京腔 | 1.1 | 1.0 | 大咧咧，带调侃味 |
| coach | 知性 | 0.9 | 0.95 | 温和鼓励，分析清晰 |
| netizen | 活泼 | 1.2 | 1.1 | 情绪波动大，吐槽感 |

### 动态温度（后续增强）

当前版本使用静态 per-persona VoiceProfile 参数。动态 tension 调节（棋局紧张时自动拉高 temperature）依赖 chat WebSocket 消息携带 tension，需在前端链路增加字段传递，作为后续功能。

## 接口

### moss-tts-nano serve API

| 端点 | 方法 | 用途 |
|------|------|------|
| `/health` | GET | 健康检查，等待模型加载完成 |
| `/api/generate` | POST | 一次性生成（不推荐但保留） |
| `/api/generate-stream/start` | POST | 启动流式生成，返回 stream_id |
| `/api/generate-stream/{id}/status` | GET | 查询流状态 |
| `/api/generate-stream/{id}/audio` | GET | 获取 WAV 音频块（轮询） |
| `/api/generate-stream/{id}/close` | POST | 关闭流 |

### moss-tts-nano serve 请求参数

| 参数 | 类型 | 默认 | 说明 |
|------|------|------|------|
| text | string | 必填 | 合成文本 |
| prompt_audio | file | 必填 | 参考音频（音色克隆） |
| text_temperature | float | 1.0 | 文字层采样温度 |
| audio_temperature | float | 0.8 | 音频层采样温度 |
| audio_top_p | float | 0.95 | 音频 top-p |
| audio_top_k | int | 25 | 音频 top-k |
| audio_repetition_penalty | float | 1.2 | 音频重复惩罚 |
| max_new_frames | int | 375 | 最大生成帧数 |
| enable_text_normalization | string | "1" | 启用 WeTextProcessing |
| do_sample | string | "1" | 采样模式 |
| cpu_threads | int | 4 | CPU 线程数 |

## 文件改动

| 操作 | 文件 | 内容 |
|------|------|------|
| 新建 | `server/src/voice/moss-tts.ts` | synthesizeAudio() 流式调用 moss-tts-nano API；VoiceProfile 类型；tension→温度映射 |
| 新建 | `server/src/voice/voice-profiles.ts` | 四角色默认 VoiceProfile 配置 |
| 新建 | `server/assets/tts/` | 参考音频存放目录 |
| 修改 | `server/src/config/defaults.ts` | TtsCfg 接口和默认值 |
| 修改 | `server/src/config/validate.ts` | tts 段移除 aliyuncs.com 限制 |
| 修改 | `server/src/ws-server.ts` | /tts 路由实现；moss-tts-nano 进程管理；静态文件服务 |
| 修改 | `server/src/config/runtime-config.ts` | voiceForPersona() 返回 VoiceProfile |
| 修改 | `server/src/store/settings-repo.ts` | PersonaConfig.ttsVoice 字段含义变为参考音频路径 |
| 删除 | `server/src/voice/dashscope-tts.ts` | 不再需要 |
| 删除 | `server/src/voice/dashscope-tts.test.ts` | 不再需要 |
| 不修改 | 前端所有文件 | /tts 接口保持 { url } 不变 |

## 进程管理

- `buildServer()` 启动时 spawn `moss-tts-nano serve --device cpu --port 18083`
- 子进程输出转发到 Fastify 日志
- 轮询 `GET /health`（最多 120 秒超时），等待 `status: "ok"`
- `app.onClose` hook 中 kill 子进程（SIGTERM → 5s → SIGKILL）

## 流式生成流程

1. POST `/api/generate-stream/start`，传 text + prompt_audio + 采样参数
2. 获取 stream_id
3. 循环：GET `/api/generate-stream/{id}/status` 检查状态
4. 每次有新音频时，GET `/api/generate-stream/{id}/audio` 获取 WAV 字节
5. 收集所有块，拼接为完整 WAV
6. 写入 `static/tts/{uuid}.wav`
7. 返回 `{ url }` 给前端

## 错误处理

- moss-tts-nano 不可用 → 503，前端回退 browser-tts（已有逻辑）
- 流式生成失败 → 回退 `/api/generate` 一次性生成
- 参考音频缺失 → 500，日志记录
- 超时保护：单次合成最长 30s

## 测试

- `server/src/voice/moss-tts.test.ts`：mock moss-tts-nano HTTP 响应，验证流式收集逻辑
- `server/src/voice/voice-profiles.test.ts`：验证 tension→温度映射
- 更新受影响的测试：runtime-config.test.ts、validate.test.ts
