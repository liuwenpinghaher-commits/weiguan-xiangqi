# TTS 参考音频

此目录存放 moss-tts-nano 音色克隆所需的参考音频文件(均取自 moss 官方样本库 `engine/moss-tts-nano/assets/audio/`)。
每个角色的默认音色见 `server/src/voice/voice-profiles.ts` 的 `DEFAULT_VOICE_PROFILES`;控制台"角色"标签可换。

| 文件 | 音色 | 默认使用者 | 源样本 |
|---|---|---|---|
| `reference.wav` | 京味茶馆口播 | 老炮儿(laopaoer),兼全局回退 | zh_3 |
| `biaozhun.wav` | 标准口播 | 老黑(player) | zh_1 |
| `jiangtang.wav` | 讲堂主播 | 林教练(coach) | zh_10 |
| `taiwanqiang.wav` | 台湾腔·活泼 | 网友(netizen) | zh_4 |
| `wanfeng.wav` | 电台晚风·温柔 | (备选) | zh_6 |

自定义:放入 3–10s 干净人声 WAV,在控制台角色标签或 `persona_config.tts_voice` 填相对 server/ 根的路径即可。
