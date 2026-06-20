import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'

/**
 * 按人设返回已实测可用的 CosyVoice 音色 ID。
 * player    → longcheng_v2   沉稳中年男
 * laopaoer  → longhua_v2     浑厚老炮味
 * coach     → longshu_v2     书生播音/教师感
 * netizen   → longshuo_v2    利落年轻男
 * 其它/默认 → longxiaochun_v2
 */
export function voiceForPersona(personaId: string): string {
  const map: Record<string, string> = {
    player:   'longcheng_v2',
    laopaoer: 'longhua_v2',
    coach:    'longshu_v2',
    netizen:  'longshuo_v2',
  }
  return map[personaId] ?? 'longxiaochun_v2'
}

export interface TtsCfg {
  wsUrl: string
  apiKey: string
  model: string
}

/**
 * 调用百炼 CosyVoice WebSocket API 合成语音,返回 MP3 Buffer。
 * 协议:连接后发三帧 JSON(run-task / continue-task / finish-task),
 * 音频以二进制帧推送,收到 task-finished 后 resolve 累积 Buffer。
 * 超时 15 秒或 task-failed 则 reject。
 */
export async function synthesize(
  text: string,
  voice: string,
  cfg: TtsCfg,
): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const taskId = randomUUID()
    const chunks: Buffer[] = []
    let started = false
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      ws.close()
      reject(new Error('CosyVoice TTS 超时(15s)'))
    }, 15_000)

    const ws = new WebSocket(cfg.wsUrl, {
      headers: { Authorization: `Bearer ${cfg.apiKey}` },
    })

    ws.on('error', (err) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(err)
    })

    ws.on('open', () => {
      // run-task 帧
      ws.send(JSON.stringify({
        header: {
          action: 'run-task',
          task_id: taskId,
          streaming: 'duplex',
        },
        payload: {
          task_group: 'audio',
          task: 'tts',
          function: 'SpeechSynthesizer',
          model: cfg.model,
          parameters: {
            text_type: 'PlainText',
            voice,
            format: 'mp3',
            sample_rate: 22050,
            volume: 60,
            rate: 1,
            pitch: 1,
          },
          input: {},
        },
      }))
    })

    ws.on('message', (data, isBinary) => {
      if (isBinary) {
        // 二进制帧 = 音频数据
        chunks.push(Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer))
        return
      }

      let frame: any
      try {
        frame = JSON.parse(data.toString())
      } catch {
        return
      }

      const event: string = frame?.header?.event ?? ''

      if (event === 'task-started' && !started) {
        started = true
        // continue-task 帧:发送文本
        ws.send(JSON.stringify({
          header: {
            action: 'continue-task',
            task_id: taskId,
            streaming: 'duplex',
          },
          payload: { input: { text } },
        }))
        // finish-task 帧:紧接发送
        ws.send(JSON.stringify({
          header: {
            action: 'finish-task',
            task_id: taskId,
            streaming: 'duplex',
          },
          payload: { input: {} },
        }))
      } else if (event === 'task-finished') {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ws.close()
        resolve(Buffer.concat(chunks))
      } else if (event === 'task-failed') {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ws.close()
        reject(new Error(frame?.header?.error_message ?? 'CosyVoice task-failed'))
      }
    })

    ws.on('close', () => {
      if (settled) return
      // 连接关闭但未 settled:若已有数据则 resolve,否则 reject
      settled = true
      clearTimeout(timer)
      if (chunks.length > 0) {
        resolve(Buffer.concat(chunks))
      } else {
        reject(new Error('CosyVoice WebSocket 意外关闭,无音频数据'))
      }
    })
  })
}
