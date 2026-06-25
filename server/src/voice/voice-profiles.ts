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

export const DEFAULT_VOICE_PROFILES: Record<string, VoiceProfile> = {
  player: {
    referenceAudio: DEFAULT_REFERENCE_AUDIO,
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
    referenceAudio: DEFAULT_REFERENCE_AUDIO,
    textTemperature: 0.95,
    audioTemperature: 0.9,
    audioTopP: 0.92,
    audioTopK: 25,
    audioRepetitionPenalty: 1.2,
    maxNewFrames: 375,
  },
  netizen: {
    referenceAudio: DEFAULT_REFERENCE_AUDIO,
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
