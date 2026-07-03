export interface VoiceProfile {
  referenceAudio: string
  textTemperature: number
  audioTemperature: number
  audioTopP: number
  audioTopK: number
  audioRepetitionPenalty: number
  maxNewFrames: number
}

export const DEFAULT_REFERENCE_AUDIO = 'assets/tts/reference.wav'

// 每个角色一个专属参考音频(moss 音色克隆源,文件在 server/assets/tts/,取自 moss 官方样本库),
// 按人设选:老炮儿=京味茶馆(即默认参考音),教练=讲堂主播,网友=台湾腔活泼,棋手老黑=标准口播。
export const DEFAULT_VOICE_PROFILES: Record<string, VoiceProfile> = {
  player: {
    referenceAudio: 'assets/tts/biaozhun.wav',
    textTemperature: 0.8,
    audioTemperature: 0.7,
    audioTopP: 0.9,
    audioTopK: 20,
    audioRepetitionPenalty: 1.1,
    maxNewFrames: 350,
  },
  laopaoer: {
    referenceAudio: DEFAULT_REFERENCE_AUDIO,
    textTemperature: 1.0,
    audioTemperature: 1.1,
    audioTopP: 0.95,
    audioTopK: 30,
    audioRepetitionPenalty: 1.3,
    maxNewFrames: 375,
  },
  coach: {
    referenceAudio: 'assets/tts/jiangtang.wav',
    textTemperature: 0.95,
    audioTemperature: 0.9,
    audioTopP: 0.92,
    audioTopK: 25,
    audioRepetitionPenalty: 1.2,
    maxNewFrames: 375,
  },
  netizen: {
    referenceAudio: 'assets/tts/taiwanqiang.wav',
    textTemperature: 1.1,
    audioTemperature: 1.2,
    audioTopP: 0.95,
    audioTopK: 35,
    audioRepetitionPenalty: 1.4,
    maxNewFrames: 400,
  },
}

export function defaultVoiceProfile(): VoiceProfile {
  return {
    referenceAudio: DEFAULT_REFERENCE_AUDIO,
    textTemperature: 1.0,
    audioTemperature: 0.8,
    audioTopP: 0.95,
    audioTopK: 25,
    audioRepetitionPenalty: 1.2,
    maxNewFrames: 375,
  }
}
