import { writeFileSync, mkdirSync, existsSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { VoiceProfile } from './voice-profiles.js'
import type { TtsCfg } from '../config/defaults.js'

const TTS_OUTPUT_DIR = join(import.meta.dirname, '..', '..', 'static', 'tts')
// CPU 推理实测 RTF≈1.3(短句 3s 音频约 4s 合成);较长台词需要余量,60s 兜底。
const TTS_TIMEOUT_MS = 60_000

// moss-tts-nano 的 WeTextProcessing(数字/符号 FST 规整)依赖 pynini/OpenFst,
// 安装极难且在纯中文象棋播报场景价值很低。默认关闭;设 MOSS_TTS_TEXT_NORMALIZATION=1 显式开启
// (需在 venv 里额外装好 WeTextProcessing,否则该模型会对开启的请求返回 500)。
const TTS_TEXT_NORMALIZATION = process.env.MOSS_TTS_TEXT_NORMALIZATION === '1' ? '1' : '0'

function ensureOutputDir(): void {
  if (!existsSync(TTS_OUTPUT_DIR)) mkdirSync(TTS_OUTPUT_DIR, { recursive: true })
}

// 产物清理:wav 播完即弃,超过 TTL 的旧文件在每次合成前顺手清掉,
// 修"合成产物零清理 → 磁盘无界增长"。节流:最多每分钟扫一次目录。
const TTS_FILE_TTL_MS = 60 * 60 * 1000
let lastCleanupAt = 0
function cleanupOldTts(): void {
  const now = Date.now()
  if (now - lastCleanupAt < 60_000) return
  lastCleanupAt = now
  try {
    for (const f of readdirSync(TTS_OUTPUT_DIR)) {
      if (!f.endsWith('.wav')) continue
      const full = join(TTS_OUTPUT_DIR, f)
      try {
        if (now - statSync(full).mtimeMs > TTS_FILE_TTL_MS) unlinkSync(full)
      } catch { /* 单文件失败跳过 */ }
    }
  } catch { /* 目录不可读时静默,不影响合成 */ }
}

function uid(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 解析参考音频绝对路径(moss voice_clone 必需)。
 * profile.referenceAudio 可能是残留的云端音色名(如 "Dylan")或已删除的自定义 wav——
 * 不存在时回退 cfg.referenceAudio;都不存在返回 null,由调用方抛明确错误
 * (否则 moss 收不到 prompt_audio 会报晦涩的 400 "demo_id is required")。
 */
function resolveReferenceAudio(profile: VoiceProfile, cfg: TtsCfg): string | null {
  const serverRoot = join(import.meta.dirname, '..', '..')
  for (const p of [profile.referenceAudio, cfg.referenceAudio]) {
    if (!p) continue
    const full = join(serverRoot, p)
    if (existsSync(full)) return full
  }
  return null
}

const REF_AUDIO_MISSING_MSG =
  '缺参考音频:moss-tts-nano voice_clone 需要 prompt_audio。请确认 server/assets/tts/reference.wav 存在,或 persona 的 ttsVoice 指向有效 wav 路径'

// ── 服务端串行化 ──────────────────────────────────────────────────────────
// moss-tts-nano 是单线程(单 CPU 执行锁):同一时刻只能算一条。前端为每条弹幕都打
// /tts,突发并发会在 moss 内部堆积,一旦某请求触发 60s 超时被 abort、又与有界音频
// 队列相互作用,可能把整个 moss 拖入假死(0% CPU 死锁,连状态接口都不再应答,唯有
// 重启才恢复——这正是"语音突然没声音"的根因)。故在服务端串行:同一时刻只放行 1 个
// 合成,其余排队;排队过深直接拒绝,由调用方回退浏览器 TTS,避免把 moss 打垮。
const TTS_MAX_PENDING = 3
let ttsPending = 0
let ttsChain: Promise<unknown> = Promise.resolve()

/**
 * 合成入口(串行化包装):并发调用会排队,队列满(>=TTS_MAX_PENDING)即抛错拒绝。
 * 真正的合成逻辑在 synthesizeAudioInner。
 */
export async function synthesizeAudio(
  text: string,
  profile: VoiceProfile,
  cfg: TtsCfg,
): Promise<string> {
  if (ttsPending >= TTS_MAX_PENDING) {
    throw new Error('TTS 繁忙(合成队列已满,已跳过本次语音以保护 moss)')
  }
  ttsPending++
  const run = ttsChain.then(() => synthesizeAudioInner(text, profile, cfg))
  // 链不因单次失败而断裂:吞掉结果只保留"完成"信号,下一个请求接续执行
  ttsChain = run.then(() => undefined, () => undefined)
  try {
    return await run
  } finally {
    ttsPending--
  }
}

/**
 * 流式合成:调用 moss-tts-nano /api/generate-stream/start,
 * 轮询收集音频块,拼接成完整 WAV 写入 static/tts/,
 * 返回可访问的相对 URL 路径。
 *
 * 失败时若 streaming=true 且流式失败,回退 /api/generate 一次性合成。
 */
async function synthesizeAudioInner(
  text: string,
  profile: VoiceProfile,
  cfg: TtsCfg,
): Promise<string> {
  const clipped = text.slice(0, 500)
  const id = uid()
  ensureOutputDir()
  cleanupOldTts()
  const outputPath = join(TTS_OUTPUT_DIR, `${id}.wav`)

  if (cfg.streaming) {
    try {
      const wav = await synthesizeStream(clipped, profile, cfg)
      writeFileSync(outputPath, wav)
      return `/static/tts/${id}.wav`
    } catch (err) {
      // 流式失败,回退一次性生成(仅当错误与 stream 相关时)
      const msg = (err as Error).message ?? ''
      if (!msg.includes('stream') && !msg.includes('ECONNREFUSED')) throw err
    }
  }

  // 一次性生成(非流式或流式回退)
  const wav = await synthesizeOnce(clipped, profile, cfg)
  writeFileSync(outputPath, wav)
  return `/static/tts/${id}.wav`
}

/**
 * 流式合成: POST /api/generate-stream/start → GET /audio 单次流式读尽(边生成边消费)
 * → 按响应头(pcm_s16le + 采样率/声道)把裸 PCM 包成 WAV 返回。
 *
 * 端点语义(读 app.py 源码 + 实测踩坑后确定):
 * - /audio 是一次性 hold-open 的裸 PCM 流;生产端音频队列有界(Queue maxsize=64),
 *   必须持续消费——否则超过 ~64 块的长句会让生成线程阻塞在入队,且它占着 CPU 执行锁,
 *   之后所有合成请求都会排队直到超时,整个 TTS 假死(只能重启 moss 才恢复)。
 * - 流以哨兵自然结束(成功与失败路径都会放);零字节结束 = 生成失败,查 /status 取原因。
 * - finally 必调 /close:服务端 is_closed 标志会让生产线程 0.1s 内取消,
 *   超时中止(abort)后也不留泄漏任务空烧 CPU。close 不能共享主 signal(abort 后还要能发出)。
 */
async function synthesizeStream(
  text: string,
  profile: VoiceProfile,
  cfg: TtsCfg,
): Promise<Buffer> {
  const base = cfg.mossNanoUrl

  // 1. 启动流式生成
  const startBody = new FormData()
  startBody.append('text', text)
  startBody.append('text_temperature', String(profile.textTemperature))
  startBody.append('audio_temperature', String(profile.audioTemperature))
  startBody.append('audio_top_p', String(profile.audioTopP))
  startBody.append('audio_top_k', String(profile.audioTopK))
  startBody.append('audio_repetition_penalty', String(profile.audioRepetitionPenalty))
  startBody.append('max_new_frames', String(profile.maxNewFrames))
  startBody.append('enable_text_normalization', TTS_TEXT_NORMALIZATION)
  startBody.append('do_sample', '1')

  // 附加参考音频文件(必需;解析失败即抛错,避免 moss 晦涩 400)
  const refFull = resolveReferenceAudio(profile, cfg)
  if (!refFull) throw new Error(REF_AUDIO_MISSING_MSG)
  {
    const buf = await readFile(refFull)
    const blob = new Blob([buf], { type: 'audio/wav' })
    startBody.append('prompt_audio', blob, 'reference.wav')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS)
  let streamId: string | undefined
  try {
    // 1. 启动流式生成
    const startResp = await fetch(`${base}/api/generate-stream/start`, {
      method: 'POST',
      body: startBody,
      signal: ctrl.signal,
    })
    if (!startResp.ok) {
      throw new Error(`moss-tts-nano stream start HTTP ${startResp.status}`)
    }
    const json = (await startResp.json()) as { stream_id?: string }
    streamId = json.stream_id
    if (!streamId) throw new Error('moss-tts-nano 未返回 stream_id')

    // 2. 单次 GET /audio,增量读尽整条 PCM 流(持续消费 = 生成端队列永不阻塞)
    const audioResp = await fetch(`${base}/api/generate-stream/${streamId}/audio`, {
      signal: ctrl.signal,
    })
    if (!audioResp.ok || !audioResp.body) {
      throw new Error(`moss-tts-nano stream audio HTTP ${audioResp.status}`)
    }
    const sampleRate = Number(audioResp.headers.get('x-audio-sample-rate')) || 24000
    const channels = Number(audioResp.headers.get('x-audio-channels')) || 1
    const chunks: Buffer[] = []
    for await (const chunk of audioResp.body) {
      chunks.push(Buffer.from(chunk as Uint8Array))
    }
    const pcm = Buffer.concat(chunks)

    // 3. 零字节结束 = 生成失败(哨兵先于任何音频到达)→ 查 /status 拿失败原因
    if (pcm.length === 0) {
      let reason = 'unknown'
      try {
        const st = await fetch(`${base}/api/generate-stream/${streamId}/status`, { signal: ctrl.signal })
        const sj = (await st.json()) as { error?: string; state?: string }
        reason = sj.error ?? sj.state ?? 'unknown'
      } catch { /* 拿不到原因就报 unknown */ }
      throw new Error(`moss-tts-nano stream failed: ${reason}`)
    }

    return wrapPcm16Wav(pcm, sampleRate, channels)
  } finally {
    clearTimeout(timer)
    // 必调 close:让服务端取消/清理任务(独立 signal,主 signal 已 abort 时也要能发出)
    if (streamId) {
      const closeUrl = `${base}/api/generate-stream/${streamId}/close`
      fetch(closeUrl, { method: 'POST', signal: AbortSignal.timeout(3000) })
        .catch(() => { /* best-effort close */ })
    }
  }
}

/** 裸 PCM(s16le)加 44 字节 RIFF 头 → 标准 WAV。 */
function wrapPcm16Wav(pcm: Buffer, sampleRate: number, channels: number): Buffer {
  const blockAlign = channels * 2
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8)
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * blockAlign, 28)
  h.writeUInt16LE(blockAlign, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

/**
 * 一次性合成(流式失败时的回退): POST /api/generate → 返回 base64 WAV buffer
 */
async function synthesizeOnce(
  text: string,
  profile: VoiceProfile,
  cfg: TtsCfg,
): Promise<Buffer> {
  const base = cfg.mossNanoUrl

  const body = new FormData()
  body.append('text', text)
  body.append('text_temperature', String(profile.textTemperature))
  body.append('audio_temperature', String(profile.audioTemperature))
  body.append('audio_top_p', String(profile.audioTopP))
  body.append('audio_top_k', String(profile.audioTopK))
  body.append('audio_repetition_penalty', String(profile.audioRepetitionPenalty))
  body.append('max_new_frames', String(profile.maxNewFrames))
  body.append('enable_text_normalization', TTS_TEXT_NORMALIZATION)
  body.append('do_sample', '1')

  const refFull = resolveReferenceAudio(profile, cfg)
  if (!refFull) throw new Error(REF_AUDIO_MISSING_MSG)
  {
    const buf = await readFile(refFull)
    const blob = new Blob([buf], { type: 'audio/wav' })
    body.append('prompt_audio', blob, 'reference.wav')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS)
  try {
    const resp = await fetch(`${base}/api/generate`, {
      method: 'POST',
      body,
      signal: ctrl.signal,
    })
    if (!resp.ok) {
      throw new Error(`moss-tts-nano generate HTTP ${resp.status}`)
    }
    const json = (await resp.json()) as { audio_base64?: string; error?: string }
    if (json.error) throw new Error(json.error)
    if (!json.audio_base64) throw new Error('moss-tts-nano 返回无音频数据')
    return Buffer.from(json.audio_base64, 'base64')
  } finally {
    clearTimeout(timer)
  }
}
