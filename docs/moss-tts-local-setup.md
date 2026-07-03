# 本地 TTS(moss-tts-nano)落地指南

围观象棋的服务端 TTS 走**本地** [moss-tts-nano](https://github.com/OpenMOSS/MOSS-TTS-Nano)(OpenMOSS 开源实时多语种小型 TTS),
后端 `/tts` 路由把观棋者发言合成为 WAV,前端播放;引擎不可用时**自动回退浏览器 Web Speech**。
本文记录一次已验证的可复现安装步骤(仓库上游未提供安装说明)。

## 组件关系

```
浏览器 speakServer ──fetch──▶ 后端 GET /tts ──▶ synthesizeAudio (server/src/voice/moss-tts.ts)
                                                    │  spawn(MOSS_TTS_BIN, serve --device cpu --port 18083)
                                                    ▼
                                     moss-tts-nano FastAPI (app.py, :18083)
                                       /api/generate-stream/start|status|audio|close
                                       /api/generate
```

- 端口 18083 与 `DEFAULTS.tts.mossNanoUrl`(`server/src/config/defaults.ts`)一致。
- 请求字段(`text/prompt_audio/max_new_frames/do_sample/*temperature*`)与 app.py 的 Form 参数一一对应。
- 响应字段(`stream_id / state / ready / failed / audio_base64`)与 moss-tts.ts 读取一致。

## 前置

- **Python 3.10–3.13**(上游 `torch==2.7.0` 无 3.14 wheel;本项目用 **3.12**)。
- 推荐 [uv](https://github.com/astral-sh/uv) 装依赖(快)。
- 模型权重(**用 ModelScope,别走 HuggingFace**,见下节)。

## 安装步骤(本仓库已执行)

引擎解压在 `engine/moss-tts-nano/`(`/engine/` 已 gitignore,不入库):

```bash
cd engine/moss-tts-nano
uv venv --python 3.12 .venv
source .venv/bin/activate
# 只装核心依赖(pyproject),跳过 requirements.txt 里的 WeTextProcessing —— 见下方“文本规整”说明
uv pip install -e . soundfile
```

装完 `moss-tts-nano` 命令位于 `engine/moss-tts-nano/.venv/bin/moss-tts-nano`。

## 模型权重:用 ModelScope(HF 大文件在本网络卡死)

实测(2026-07-02):HuggingFace 小文件可下,**大 LFS 权重文件到几十 MB 即卡死**(hf-mirror.com 对该仓库也只是 308 重定向回 HF,无效)。
另注意:HF 上 `OpenMOSS-Team/MOSS-TTS-Nano` 已**重定向到 `MOSS-TTS-Nano-100M`**,代码默认仓库名会解析失败。

用魔搭 ModelScope 下载(国内直连,实测 ~18MB/s):

```bash
source .venv/bin/activate
uv pip install modelscope
modelscope download --model OpenMOSS/MOSS-TTS-Nano-100M      --local_dir .models/nano-100m
modelscope download --model OpenMOSS/MOSS-Audio-Tokenizer-Nano --local_dir .models/audio-tok
```

## 本地补丁:app.py 预热不再硬依赖 WeTextProcessing

上游 `app.py` 启动预热会 `ensure_ready()` 文本规整器,缺 `tn` 模块(pynini)时**整个预热 fail、服务永远 not ready**。
已在 `app.py` `main()` 里打本地补丁:探测 `import tn` 失败则把 `text_normalizer_manager` 置 `None`(工厂全链对 None 安全),预热跳过规整阶段。
**engine/ 目录不入 git**——若重新解压上游 zip,需重打该补丁(搜 `围观象棋本地补丁`)。

## 接线到后端

后端 spawn 的是裸命令 `moss-tts-nano serve --device cpu --port <port>`,不带 checkpoint 参数——直接指 venv 二进制会又走默认 HF 仓库名。
所以用**包装脚本** `engine/moss-tts-nano/serve-wrapper.sh`(注入本地权重路径 + 离线开关):

```bash
# server/.env
MOSS_TTS_BIN=/绝对路径/围观象棋/engine/moss-tts-nano/serve-wrapper.sh
MOSS_TTS_TEXT_NORMALIZATION=0   # 见下方说明,默认关
```

启动后端即自动拉起 moss;权重已本地化,预热约 30s(Apple Silicon CPU),就绪后 `/tts` 即可合成。

## 参考音频(音色克隆,必需)

moss 走 voice_clone,`prompt_audio` 缺失会 400。每个角色一个专属默认参考音频
(见 `server/assets/tts/README.md` 的映射表与 `voice-profiles.ts` 的 `DEFAULT_VOICE_PROFILES`):
老炮儿=京味茶馆(reference.wav,兼全局回退)、老黑=标准口播、教练=讲堂主播、网友=台湾腔。
可替换为任意 3–10s 干净人声 WAV;控制台"角色"标签可随时换。

## 文本规整(WeTextProcessing)—— 默认关闭

上游 `enable_text_normalization=1` 依赖 `WeTextProcessing → pynini → OpenFst`(C++,pip 无 wheel,极难装)。
纯中文象棋播报几乎不含需 FST 规整的数字/符号,故本项目默认 `MOSS_TTS_TEXT_NORMALIZATION=0`。
缺该模块时 moss 服务仍能正常启动(预加载失败仅告警),但若开启该开关会对请求返回 500。
确需开启:在 venv 内额外装好 `WeTextProcessing`(先 `brew install openfst` 再装 pynini),然后设 `=1`。

## 冒烟验证

```bash
# 预热就绪后直接测合成
curl -X POST http://127.0.0.1:18083/api/generate \
  -F "text=炮二平五，马8进7。" \
  -F "prompt_audio=@server/assets/tts/reference.wav" \
  -F "enable_text_normalization=0" -F "do_sample=1" -F "max_new_frames=375"
# 返回 JSON 含 audio_base64 即成功
```

不可用时后端 `/tts` 返回 503,前端自动回退浏览器 Web Speech —— 语音功能不会中断。

## 已踩过的集成坑(2026-07-02 实测修复)

1. **persona ttsVoice 残留云音色名**:云端 qwen3-tts 时代 DB `persona_config.tts_voice` 存的是
   `Dylan/Ethan/Serena/Eric` 这类音色名;迁移 moss 后该字段语义变为**参考音频路径**,残留值导致
   参考音频解析失败 → moss 收不到 `prompt_audio` → 报晦涩的 400 `demo_id is required`。
   修复:`moss-tts.ts` 的 `resolveReferenceAudio` 回退链(profile 路径无效 → 全局默认 → 都缺则抛明确错误);
   DB 残留值已更新为 `assets/tts/reference.wav`;控制台音色下拉(`console-data.ts VOICES`)已改为参考音频路径。
2. **`/api/generate-stream/{id}/audio` 不是轮询端点**:它是一次性 hold-open 的**裸 PCM 流**
   (为浏览器 demo 边播边取设计,无 WAV 头);重复 GET 会在空队列上挂起直到超时。
   正确用法(现实现):轮询 `/status` 至 `ready`,再从 `/result` 取完整 `audio_base64`(WAV),最后 `/close`。
3. CPU 合成速度 RTF≈1.3(M 系 Mac,短句 2.6s 音频约 3-4s),`TTS_TIMEOUT_MS` 已放宽到 60s。
