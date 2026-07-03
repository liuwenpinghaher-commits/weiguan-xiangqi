#!/usr/bin/env node
/**
 * 真实语音交互往返测试(借用「专访 1.0」scripts/gen-voice-fixtures.mjs 的 DashScope
 * 合成手法,适配围观象棋的真实语音链路)。
 *
 * 链路:
 *   1) 云端 TTS 合成:qwen3-tts-flash(DASHSCOPE_TTS_ENDPOINT / multimodal-generation)
 *      —— 若失败,回退 CosyVoice WS(gen-voice-fixtures 同款,已证可用)。
 *   2) 真实 ASR 转写:qwen3-asr-flash(OpenAI 兼容 chat/completions + input_audio),
 *      与 server/src/voice/dashscope-asr.ts 走同一端点/模型。
 *   3) 校验转写文本 ≈ 原文,证明「说话→识别」真实链路打通。
 *
 * 用法:node server/scripts/voice-roundtrip.mjs
 * 读取 server/.env 的 DASHSCOPE_API_KEY / DASHSCOPE_BASE_URL / DASHSCOPE_TTS_* / ASR_MODEL。
 */
import { readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import WebSocket from 'ws'
import OpenAI from 'openai'

function loadEnv(url) {
  const env = {}
  try {
    for (const line of readFileSync(url, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/)
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
    }
  } catch {}
  return env
}

const env = loadEnv(new URL('../.env', import.meta.url))
const KEY = env.DASHSCOPE_API_KEY
const BASE_URL = env.DASHSCOPE_BASE_URL ?? 'https://dashscope.aliyuncs.com/compatible-mode/v1'
const TTS_ENDPOINT = env.DASHSCOPE_TTS_ENDPOINT ?? 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
const TTS_MODEL = env.DASHSCOPE_TTS_MODEL ?? 'qwen3-tts-flash'
const ASR_MODEL = env.ASR_MODEL ?? 'qwen3-asr-flash'

if (!KEY) { console.error('❌ 缺 DASHSCOPE_API_KEY(server/.env)'); process.exit(1) }
console.log(`\nKey prefix: ${KEY.slice(0, 8)}…  TTS=${TTS_MODEL}  ASR=${ASR_MODEL}\n`)

// 中文象棋测试语句(贴近本项目真实弹幕/走子播报场景)
const PHRASES = ['炮二平五，当头炮开局。', '这步马后炮杀得漂亮。']

// ── TTS-A:qwen3-tts-flash(项目配置的云端 TTS 端点) ──────────────────────────
async function ttsQwen(text) {
  const body = {
    model: TTS_MODEL,
    input: { text, voice: 'Cherry' },
    parameters: { language_type: 'Chinese' },
  }
  const r = await fetch(TTS_ENDPOINT, {
    method: 'POST',
    headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(60000),
  })
  const txt = await r.text()
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${txt.slice(0, 200)}`)
  const j = JSON.parse(txt)
  const url = j.output?.audio?.url
  const data = j.output?.audio?.data
  if (url) {
    const ab = await (await fetch(url, { signal: AbortSignal.timeout(30000) })).arrayBuffer()
    return { buf: Buffer.from(ab), mime: url.endsWith('.mp3') ? 'audio/mp3' : 'audio/wav', via: `${TTS_MODEL}(url)` }
  }
  if (data) return { buf: Buffer.from(data, 'base64'), mime: 'audio/wav', via: `${TTS_MODEL}(base64)` }
  throw new Error(`200 但无 audio.url/data: ${txt.slice(0, 200)}`)
}

// ── TTS-B 回退:CosyVoice WS(gen-voice-fixtures 同款,产 PCM→包 WAV) ──────────
function wrapWav(pcm, sr = 16000) {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12)
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22)
  h.writeUInt32LE(sr, 24); h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34)
  h.write('data', 36); h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}
function ttsCosy(text) {
  const SR = 16000
  const WS_URL = 'wss://dashscope.aliyuncs.com/api-ws/v1/inference'
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(WS_URL, { headers: { Authorization: `Bearer ${KEY}` } })
    const taskId = randomUUID()
    const chunks = []
    let done = false
    const finish = (buf, err) => { if (done) return; done = true; try { ws.close() } catch {} err ? reject(err) : resolve(buf) }
    const timer = setTimeout(() => finish(null, new Error('cosy tts timeout')), 30000)
    ws.on('open', () => ws.send(JSON.stringify({
      header: { action: 'run-task', task_id: taskId, streaming: 'duplex' },
      payload: { task_group: 'audio', task: 'tts', function: 'SpeechSynthesizer', model: 'cosyvoice-v3-plus',
        parameters: { text_type: 'PlainText', voice: 'longanyang', format: 'pcm', sample_rate: SR }, input: {} },
    })))
    ws.on('message', (data, isBinary) => {
      if (isBinary || (Buffer.isBuffer(data) && data[0] !== 0x7b)) { chunks.push(Buffer.from(data)); return }
      let msg = {}; try { msg = JSON.parse(data.toString()) } catch { chunks.push(Buffer.from(data)); return }
      const ev = msg.header?.event
      if (ev === 'task-started') {
        ws.send(JSON.stringify({ header: { action: 'continue-task', task_id: taskId, streaming: 'duplex' }, payload: { input: { text } } }))
        ws.send(JSON.stringify({ header: { action: 'finish-task', task_id: taskId, streaming: 'duplex' }, payload: { input: {} } }))
      } else if (ev === 'task-finished') { clearTimeout(timer); finish(chunks.length ? wrapWav(Buffer.concat(chunks), SR) : null, chunks.length ? null : new Error('no audio')) }
      else if (ev === 'task-failed') { clearTimeout(timer); finish(null, new Error(`${msg.header?.error_code}: ${String(msg.header?.error_message).slice(0, 80)}`)) }
    })
    ws.on('unexpected-response', (_q, res) => { clearTimeout(timer); let b = ''; res.on('data', d => b += d); res.on('end', () => finish(null, new Error(`HTTP ${res.statusCode}: ${b.slice(0, 200)}`))) })
    ws.on('error', e => { clearTimeout(timer); finish(null, e) })
  })
}

// ── ASR:与 dashscope-asr.ts 同款(qwen3-asr-flash,OpenAI 兼容 input_audio) ────
const client = new OpenAI({ apiKey: KEY, baseURL: BASE_URL, timeout: 30000 })
async function asr(buf, mime) {
  const dataUri = `data:${mime};base64,${buf.toString('base64')}`
  const resp = await client.chat.completions.create({
    model: ASR_MODEL,
    messages: [{ role: 'user', content: [{ type: 'input_audio', input_audio: { data: dataUri } }] }],
  })
  const c = resp.choices?.[0]?.message?.content
  return typeof c === 'string' ? c.trim() : ''
}

// 归一化:去标点空白,便于容错比对
const norm = s => s.replace(/[\s，。！？、,.!?；;：:]/g, '')
// 字符重叠率:ASR 同音字误差(如 步/不)不应判为链路失败,≥0.7 视为识别成功
function overlap(a, b) {
  const A = norm(a), B = norm(b)
  if (!A || !B) return 0
  const bag = B.split('')
  let hit = 0
  for (const ch of A) { const i = bag.indexOf(ch); if (i >= 0) { hit++; bag.splice(i, 1) } }
  return hit / Math.max(A.length, B.length)
}

let pass = 0, fail = 0
for (const phrase of PHRASES) {
  console.log(`\n──「${phrase}」`)
  let audio
  try {
    audio = await ttsQwen(phrase)
    console.log(`  TTS ✓ ${audio.via}  ${audio.buf.length} bytes (${audio.mime})`)
  } catch (e) {
    console.log(`  TTS-qwen ✗ ${e.message} → 回退 CosyVoice WS`)
    try {
      const buf = await ttsCosy(phrase)
      audio = { buf, mime: 'audio/wav', via: 'cosyvoice-v3-plus(ws)' }
      console.log(`  TTS ✓ ${audio.via}  ${audio.buf.length} bytes`)
    } catch (e2) { console.log(`  TTS 全失败 ✗ ${e2.message}`); fail++; continue }
  }
  try {
    const text = await asr(audio.buf, audio.mime)
    const sim = overlap(text, phrase)
    const ok = sim >= 0.7
    console.log(`  ASR → 「${text}」  重叠率 ${(sim * 100).toFixed(0)}%  ${ok ? '✓ 识别成功' : '⚠ 偏差过大'}`)
    ok ? pass++ : fail++
  } catch (e) { console.log(`  ASR ✗ ${e.message}`); fail++ }
}

console.log(`\n═══ 结果:${pass} 通过 / ${fail} 失败 ═══`)
process.exit(fail === 0 ? 0 : 1)
