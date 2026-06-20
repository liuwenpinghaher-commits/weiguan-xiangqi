// 浏览器 TTS 受限,只能用音高/语速区分角色;火山云 TTS 升级后换真实音色(见计划文末)
export interface VoiceParam { pitch: number; rate: number }

// personaId → 参数。pitch:0(低沉)~2(尖),rate:0.1~10(常用 0.8~1.2)
export const VOICE_PARAMS: Record<string, VoiceParam> = {
  laopaoer: { pitch: 0.8, rate: 1.05 }, // 老炮儿:低沉、略快、冲
  coach: { pitch: 1.0, rate: 0.95 },    // 林教练:平稳、慢条斯理
  netizen: { pitch: 1.25, rate: 1.18 }, // 吃瓜阿强:偏高、快、跳脱
  player: { pitch: 0.9, rate: 1.0 },    // 老黑:沉稳
}

export const DEFAULT_VOICE: VoiceParam = { pitch: 1.0, rate: 1.0 }

export function voiceParam(personaId: string): VoiceParam {
  return VOICE_PARAMS[personaId] ?? DEFAULT_VOICE
}
