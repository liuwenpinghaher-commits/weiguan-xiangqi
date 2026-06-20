/**
 * 按人设返回已实测可用的 qwen3-tts-flash 音色 ID。
 * player    → Ethan   沉稳男声
 * laopaoer  → Dylan   北京话男声(老炮儿绝配)
 * coach     → Serena  知性女声
 * netizen   → Eric    年轻男声
 * 其它/默认 → Cherry
 */
export function voiceForPersona(personaId: string): string {
  const map: Record<string, string> = {
    player:   'Ethan',
    laopaoer: 'Dylan',
    coach:    'Serena',
    netizen:  'Eric',
  }
  return map[personaId] ?? 'Cherry'
}

export interface TtsCfg {
  endpoint: string
  apiKey: string
  model: string
}

/**
 * 调用百炼 qwen3-tts-flash HTTP API 合成语音,返回 OSS 公网音频 URL(24h 有效)。
 * POST {endpoint} body: { model, input: { text, voice, language_type } }
 * 返回体: output.audio.url
 * 文本截断 ≤200 字;非 2xx 或无 url 则抛错。
 */
export async function synthesizeUrl(
  text: string,
  voice: string,
  cfg: TtsCfg,
): Promise<string> {
  const clipped = text.slice(0, 200)
  const resp = await fetch(cfg.endpoint, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${cfg.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: cfg.model,
      input: {
        text: clipped,
        voice,
        language_type: 'Chinese',
      },
    }),
  })

  if (!resp.ok) {
    const body = await resp.text().catch(() => '')
    throw new Error(`qwen3-tts-flash HTTP ${resp.status}: ${body}`)
  }

  const json = await resp.json() as { output?: { audio?: { url?: string } } }
  const url = json?.output?.audio?.url
  if (!url) {
    throw new Error(`qwen3-tts-flash 返回无 url: ${JSON.stringify(json)}`)
  }
  return url
}
