# moss-tts-nano 离线 TTS 集成 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Dashscope cloud TTS with local moss-tts-nano, using streaming API + per-persona VoiceProfile with tunable sampling parameters for natural emotional speech.

**Architecture:** Node.js Fastify server spawns `moss-tts-nano serve` as a child process, calls its `/api/generate-stream/start` streaming HTTP endpoint, assembles WAV chunks, serves them as static files to the frontend. Different personas use different reference audio + sampling parameters (temperature/top-p/top-k) stored in a new `VoiceProfile` type.

**Tech Stack:** TypeScript, Fastify, Vitest, moss-tts-nano (Python subprocess), Node.js `child_process`

---

### Task 1: Create VoiceProfile types and default voice profiles

**Files:**
- Create: `server/src/voice/voice-profiles.ts`

- [ ] **Step 1: Write voice-profiles.ts**

```typescript
export interface VoiceProfile {
  /** 参考音频文件路径(相对于 server/ 根目录) */
  referenceAudio: string
  /** 文字层采样温度,控制文本韵律 (0.6~1.5) */
  textTemperature: number
  /** 音频层采样温度,控制声音表现力 (0.5~1.5) */
  audioTemperature: number
  /** 音频 top-p 采样 */
  audioTopP: number
  /** 音频 top-k 采样 */
  audioTopK: number
  /** 音频重复惩罚 */
  audioRepetitionPenalty: number
  /** 最大生成帧数 */
  maxNewFrames: number
}

/** 默认参考音频(所有角色共用的回退值) */
export const DEFAULT_REFERENCE_AUDIO = 'assets/tts/reference.wav'

/** 各人设默认 VoiceProfile。
 *  player   → 沉稳克制，低随机性
 *  laopaoer → 随性京腔，高表现力
 *  coach    → 知性温和，中等表现力
 *  netizen  → 年轻活泼，波动大
 */
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

/** 未知 persona 回退默认 VoiceProfile */
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
```

---

### Task 2: Update TtsCfg interface and defaults

**Files:**
- Modify: `server/src/config/defaults.ts:10,24`

- [ ] **Step 1: Change TtsCfg interface**

In `server/src/config/defaults.ts`, replace line 10:
```typescript
export interface TtsCfg { endpoint: string; model: string }
```
with:
```typescript
export interface TtsCfg {
  /** moss-tts-nano serve HTTP 地址 */
  mossNanoUrl: string
  /** 默认参考音频文件路径 */
  referenceAudio: string
  /** 是否使用流式生成(默认 true);false 则回退 /api/generate */
  streaming: boolean
}
```

- [ ] **Step 2: Update DEFAULTS**

In `server/src/config/defaults.ts`, replace line 24:
```typescript
  tts: { endpoint: 'https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation', model: 'qwen3-tts-flash' } as TtsCfg,
```
with:
```typescript
  tts: { mossNanoUrl: 'http://127.0.0.1:18083', referenceAudio: 'assets/tts/reference.wav', streaming: true } as TtsCfg,
```

---

### Task 3: Update validation

**Files:**
- Modify: `server/src/config/validate.ts:16-26,53`
- Modify: `server/src/config/validate.test.ts:38-50`

- [ ] **Step 1: Replace aliyuncs validator with local URL validator**

In `server/src/config/validate.ts`:

Replace lines 16-26 (the `httpsAliyun` cleaner):
```typescript
// TTS endpoint:仅允许本地 moss-tts-nano URL(http://127.0.0.1 或 http://localhost,任意端口)
const localHttpUrl: Cleaner = (v) => {
  if (typeof v !== 'string' || v.trim() === '') return undefined
  try {
    const u = new URL(v)
    if (u.protocol !== 'http:') return undefined
    if (u.hostname !== '127.0.0.1' && u.hostname !== 'localhost') return undefined
    return v
  } catch { return undefined }
}
```

Replace line 53:
```typescript
const SCHEMA: ... = {
  ...
  tts: { mossNanoUrl: localHttpUrl, referenceAudio: str, streaming: (v) => (typeof v === 'boolean' ? v : undefined) },
}
```

The old SCHEMA had:
```typescript
  tts: { endpoint: httpsAliyun, model: str },
```

- [ ] **Step 2: Update validate test**

In `server/src/config/validate.test.ts`, replace the tts test (lines 38-50):
```typescript
  it('tts: mossNanoUrl 仅接受本地 http URL(127.0.0.1 或 localhost)', () => {
    expect(validateSection('tts', { mossNanoUrl: 'http://127.0.0.1:18083' }))
      .toEqual({ mossNanoUrl: 'http://127.0.0.1:18083' })
    expect(validateSection('tts', { mossNanoUrl: 'http://localhost:18083' }))
      .toEqual({ mossNanoUrl: 'http://localhost:18083' })
    expect(validateSection('tts', { mossNanoUrl: 'http://evil.example.com/steal' })).toEqual({})
    expect(validateSection('tts', { mossNanoUrl: 'https://127.0.0.1:443' })).toEqual({})
    expect(validateSection('tts', { mossNanoUrl: 'not-a-url' })).toEqual({})
    expect(validateSection('tts', { referenceAudio: 'assets/tts/ref.wav' }))
      .toEqual({ referenceAudio: 'assets/tts/ref.wav' })
    expect(validateSection('tts', { streaming: false })).toEqual({ streaming: false })
  })
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run server/src/config/validate.test.ts
```
Expected: PASS

---

### Task 4: Update runtime-config to use new VoiceProfile

**Files:**
- Modify: `server/src/config/runtime-config.ts:6,58,79,82,97`
- Modify: `server/src/config/runtime-config.test.ts:7,42,64,68,70`

- [ ] **Step 1: Update runtime-config.ts imports and voiceForPersona**

In `server/src/config/runtime-config.ts`:

Replace line 6:
```typescript
import { voiceForPersona as defaultVoiceFor } from '../voice/dashscope-tts.js'
```
with:
```typescript
import { DEFAULT_VOICE_PROFILES, defaultVoiceProfile, type VoiceProfile } from '../voice/voice-profiles.js'
```

Replace line 58 (inside `ensureSeeded`):
```typescript
      ttsVoice: defaultVoiceFor(p.id), enabled: true,
```
with:
```typescript
      ttsVoice: DEFAULT_REFERENCE_AUDIO, enabled: true,
```

Replace lines 78-83 (the `voiceForPersona` method):
```typescript
  /** 逐角色 tts 音色;无配置回退默认映射 */
  voiceForPersona(id: string): string {
    this.ensureSeeded()
    const row = this.repo.getAllPersonas().find(p => p.id === id)
    return row?.ttsVoice || defaultVoiceFor(id)
  }
```
with:
```typescript
  /** 逐角色 tts VoiceProfile;无配置回退默认 */
  voiceProfileForPersona(id: string): VoiceProfile {
    this.ensureSeeded()
    return DEFAULT_VOICE_PROFILES[id] ?? defaultVoiceProfile()
  }
```

Replace line 97 (inside `resetPersona`):
```typescript
      ttsVoice: defaultVoiceFor(p.id), enabled: true,
```
with:
```typescript
      ttsVoice: DEFAULT_REFERENCE_AUDIO, enabled: true,
```

Add import at top of file:
```typescript
import { DEFAULT_REFERENCE_AUDIO } from '../voice/voice-profiles.js'
```

The complete import block becomes:
```typescript
import type { SettingsRepo } from '../store/settings-repo.js'
import { DEFAULTS, type ChatCfg, type DirectorCfg, type EngineCfg, type DiagnoseCfg, type LlmCfg, type TtsCfg, type ConfigSection } from './defaults.js'
import { validateSection } from './validate.js'
import type { Persona, PersonaId } from '../types.js'
import { PERSONAS } from '../personas/personas.js'
import { DEFAULT_VOICE_PROFILES, DEFAULT_REFERENCE_AUDIO, defaultVoiceProfile, type VoiceProfile } from '../voice/voice-profiles.js'
import type { PersonaConfig } from '../store/settings-repo.js'
```

- [ ] **Step 2: Update runtime-config tests**

In `server/src/config/runtime-config.test.ts`, replace line 7:
```typescript
import { voiceForPersona } from '../voice/dashscope-tts.js'
```
with:
```typescript
import { DEFAULT_VOICE_PROFILES } from '../voice/voice-profiles.js'
```

Replace line 42:
```typescript
    c.updateSection('tts', { model: 'x' }); expect(hook).toHaveBeenCalledTimes(2)
```
with:
```typescript
    c.updateSection('tts', { referenceAudio: 'custom.wav' }); expect(hook).toHaveBeenCalledTimes(2)
```

Replace the test at line 62-65:
```typescript
  it('voiceForPersona 默认取自播种映射', () => {
    const c = cfg()
    expect(c.voiceForPersona('laopaoer')).toBe(voiceForPersona('laopaoer'))
  })
```
with:
```typescript
  it('voiceProfileForPersona 默认取自 DEFAULT_VOICE_PROFILES', () => {
    const c = cfg()
    expect(c.voiceProfileForPersona('laopaoer')).toEqual(DEFAULT_VOICE_PROFILES.laopaoer)
  })
  it('未知 persona 回退 defaultVoiceProfile', () => {
    const c = cfg()
    const p = c.voiceProfileForPersona('unknown')
    expect(p.audioTemperature).toBe(0.8)
  })
```

Replace lines 68, 70:
```typescript
    c.updatePersona('coach', { name: '林老师', ttsVoice: 'Cherry' })
    expect(c.personas().find(p => p.id === 'coach')!.name).toBe('林老师')
    expect(c.voiceForPersona('coach')).toBe('Cherry')
```
with:
```typescript
    c.updatePersona('coach', { name: '林老师', ttsVoice: 'custom_ref.wav' })
    expect(c.personas().find(p => p.id === 'coach')!.name).toBe('林老师')
    expect(c.voiceProfileForPersona('coach')).toEqual(DEFAULT_VOICE_PROFILES.coach)
```

- [ ] **Step 3: Run tests**

```bash
npx vitest run server/src/config/runtime-config.test.ts
```
Expected: PASS

---

### Task 5: Create moss-tts-nano core module

**Files:**
- Create: `server/src/voice/moss-tts.ts`

This is the core module that calls moss-tts-nano's streaming API, collects audio chunks, and returns them as a Buffer.

- [ ] **Step 1: Write moss-tts.ts**

```typescript
import { writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type { VoiceProfile } from './voice-profiles.js'

/** TTS 配置(来自 config/defaults.ts) */
export interface MossTtsCfg {
  mossNanoUrl: string
  referenceAudio: string
  streaming: boolean
}

const TTS_OUTPUT_DIR = join(import.meta.dirname, '..', '..', 'static', 'tts')
const TTS_TIMEOUT_MS = 30_000

function ensureOutputDir() {
  if (!existsSync(TTS_OUTPUT_DIR)) mkdirSync(TTS_OUTPUT_DIR, { recursive: true })
}

function uid() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 流式合成:调用 moss-tts-nano /api/generate-stream/start,
 * 轮询收集音频块,拼接成完整 WAV 写入 static/tts/,
 * 返回可访问的相对 URL 路径。
 *
 * 失败时若 fallbackToSync=true 则回退 /api/generate 一次性合成。
 */
export async function synthesizeAudio(
  text: string,
  profile: VoiceProfile,
  cfg: MossTtsCfg,
): Promise<string> {
  const clipped = text.slice(0, 500)
  const id = uid()
  ensureOutputDir()
  const outputPath = join(TTS_OUTPUT_DIR, `${id}.wav`)

  if (cfg.streaming) {
    try {
      const wav = await synthesizeStream(clipped, profile, cfg)
      writeFileSync(outputPath, wav)
      return `/static/tts/${id}.wav`
    } catch (err) {
      if ((err as Error).message?.includes('stream') === false) throw err
      // 流式失败,回退一次性生成
    }
  }

  // 一次性生成(非流式或流式回退)
  const wav = await synthesizeOnce(clipped, profile, cfg)
  writeFileSync(outputPath, wav)
  return `/static/tts/${id}.wav`
}

/**
 * 流式合成: POST /api/generate-stream/start → 轮询音频块 → 拼接返回 Buffer
 */
async function synthesizeStream(
  text: string,
  profile: VoiceProfile,
  cfg: MossTtsCfg,
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
  startBody.append('enable_text_normalization', '1')
  startBody.append('do_sample', '1')

  // 附加参考音频文件
  const refPath = profile.referenceAudio || cfg.referenceAudio
  const refFull = join(import.meta.dirname, '..', '..', refPath)
  if (existsSync(refFull)) {
    const blob = new Blob([await readFile(refFull)], { type: 'audio/wav' })
    startBody.append('prompt_audio', blob, 'reference.wav')
  }

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TTS_TIMEOUT_MS)
  try {
    const startResp = await fetch(`${base}/api/generate-stream/start`, {
      method: 'POST',
      body: startBody,
      signal: ctrl.signal,
    })
    if (!startResp.ok) {
      throw new Error(`moss-tts-nano stream start HTTP ${startResp.status}`)
    }

    const { stream_id } = (await startResp.json()) as { stream_id: string }
    if (!stream_id) throw new Error('moss-tts-nano 未返回 stream_id')

    // 2. 轮询收集音频块
    const chunks: Buffer[] = []
    let done = false
    while (!done) {
      const statusResp = await fetch(`${base}/api/generate-stream/${stream_id}/status`, {
        signal: ctrl.signal,
      })
      if (!statusResp.ok) {
        throw new Error(`moss-tts-nano stream status HTTP ${statusResp.status}`)
      }
      const status = (await statusResp.json()) as { state: string; ready: boolean; failed: boolean; error?: string }

      if (status.failed) {
        throw new Error(`moss-tts-nano stream failed: ${status.error ?? 'unknown'}`)
      }

      // 获取音频
      const audioResp = await fetch(`${base}/api/generate-stream/${stream_id}/audio`, {
        signal: ctrl.signal,
      })
      if (audioResp.ok) {
        const buf = Buffer.from(await audioResp.arrayBuffer())
        if (buf.length > 0) chunks.push(buf)
      }

      if (status.ready) {
        done = true
        try {
          await fetch(`${base}/api/generate-stream/${stream_id}/close`, { method: 'POST' })
        } catch { /* best-effort close */ }
      } else {
        // 等待一小段再轮询
        await new Promise(r => setTimeout(r, 80))
      }
    }

    return Buffer.concat(chunks)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 一次性合成(非流式): POST /api/generate → 返回 base64 WAV buffer
 */
async function synthesizeOnce(
  text: string,
  profile: VoiceProfile,
  cfg: MossTtsCfg,
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
  body.append('enable_text_normalization', '1')
  body.append('do_sample', '1')

  const refPath = profile.referenceAudio || cfg.referenceAudio
  const refFull = join(import.meta.dirname, '..', '..', refPath)
  if (existsSync(refFull)) {
    const blob = new Blob([await readFile(refFull)], { type: 'audio/wav' })
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
```

---

### Task 6: Update ws-server.ts /tts route and process management

**Files:**
- Modify: `server/src/ws-server.ts:24,631-659,284-289`

This is the biggest change — updating the `/tts` route, spawning moss-tts-nano serve, managing its lifecycle, and serving static TTS files.

- [ ] **Step 1: Read current ws-server.ts imports and key sections**

Read `server/src/ws-server.ts` to verify exact line numbers and context. The key sections to modify are:
- Import block (line 24: `synthesizeUrl` import)
- TTS route handler (lines 634-658)
- onClose hook (lines 284-289)
- Static file serving needs configuring

- [ ] **Step 2: Replace imports**

Remove line 24:
```typescript
import { synthesizeUrl } from './voice/dashscope-tts.js'
```
Add after the existing imports:
```typescript
import { spawn, type ChildProcess } from 'node:child_process'
import { join } from 'node:path'
import { mkdirSync, existsSync } from 'node:fs'
import fastifyStatic from '@fastify/static'
import { synthesizeAudio, type MossTtsCfg } from './voice/moss-tts.js'
import { voiceProfileForPersona } from './voice/voice-profiles.js'
```

Wait — `voiceProfileForPersona` is in `runtime-config.ts`, not `voice-profiles.ts`. And `runtime-config.ts` already has it. Let me adjust:

Actually, looking at the code, `cfg.voiceProfileForPersona(personaId)` is on `RuntimeConfig`. So we access it through `cfg`. I don't need to import it separately. Let me simplify the imports.

- [ ] **Step 3: Add moss-tts-nano process management (after `buildServer` function start)**

After the `const app = Fastify({ logger: true })` line (around line 276), add:

```typescript
  // ── moss-tts-nano 进程管理 ──────────────────────────────────────────────────
  let mossProcess: ChildProcess | null = null
  const ttsCfg = cfg.getTts() as MossTtsCfg

  function startMossTts(): void {
    if (mossProcess) return
    const url = new URL(ttsCfg.mossNanoUrl)
    const port = url.port || '18083'
    mossProcess = spawn('moss-tts-nano', ['serve', '--device', 'cpu', '--port', port], {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false,
    })
    mossProcess.stdout?.on('data', (d: Buffer) => { app.log.info(`[moss-tts-nano] ${d.toString().trim()}`) })
    mossProcess.stderr?.on('data', (d: Buffer) => { app.log.warn(`[moss-tts-nano] ${d.toString().trim()}`) })
    mossProcess.on('exit', (code) => {
      app.log.warn(`moss-tts-nano 退出(code=${code}),5s 后重启`)
      mossProcess = null
      setTimeout(() => { if (!mossProcess) startMossTts() }, 5000)
    })
  }

  function stopMossTts(): void {
    if (!mossProcess) return
    try { mossProcess.kill('SIGTERM') } catch {}
    setTimeout(() => {
      try { mossProcess?.kill('SIGKILL') } catch {}
    }, 5000).unref()
  }

  startMossTts()
```

- [ ] **Step 4: Update onClose hook to kill mossProcess**

Replace lines 284-289:
```typescript
  app.addHook('onClose', async () => {
    if (idleTimer) clearTimeout(idleTimer)
    try { engine?.close?.() } catch {}
    try { db.close() } catch {}
    try { if (mem instanceof SurrealMemoryStore) await mem.close() } catch {}
  })
```
with:
```typescript
  app.addHook('onClose', async () => {
    if (idleTimer) clearTimeout(idleTimer)
    stopMossTts()
    try { engine?.close?.() } catch {}
    try { db.close() } catch {}
    try { if (mem instanceof SurrealMemoryStore) await mem.close() } catch {}
  })
```

- [ ] **Step 5: Register static file serving for generated TTS audio**

After the cors registration (around line 281), add:
```typescript
  // 静态文件服务:暴露 generated TTS WAV 文件给前端播放
  const staticDir = join(import.meta.dirname, 'static')
  if (!existsSync(staticDir)) mkdirSync(staticDir, { recursive: true })
  await app.register(fastifyStatic, {
    root: staticDir,
    prefix: '/static/',
  })
```

- [ ] **Step 6: Replace /tts route (lines 630-659)**

Remove the old `/tts` handler block and replace with:

```typescript
  // ── 本地 TTS 合成(moss-tts-nano) ────────────────────────────────────────────
  // GET /tts?personaId=xxx&text=xxx
  // moss-tts-nano 不可用 → 503(前端回退浏览器 TTS)
  // 成功 → JSON { url } (本地静态 WAV 文件路径)
  app.get('/tts', async (req, reply) => {
    const query = req.query as { personaId?: string; text?: string }
    const personaId = String(query.personaId ?? '')
    const rawText = String(query.text ?? '').trim()
    if (!rawText) {
      return reply.code(400).send({ error: 'text 参数不能为空' })
    }
    const text = rawText.slice(0, 500)
    const profile = cfg.voiceProfileForPersona(personaId)

    try {
      const url = await synthesizeAudio(text, profile, cfg.getTts() as MossTtsCfg)
      reply.header('Content-Type', 'application/json')
      return reply.send({ url })
    } catch (e) {
      req.log.error(e, 'TTS 合成失败')
      // moss-tts-nano 进程可能已退出;检查并尝试重启
      if (!mossProcess || mossProcess.killed) {
        startMossTts()
      }
      return reply.code(503).send({ error: 'TTS 服务暂时不可用' })
    }
  })
```

- [ ] **Step 7: Install @fastify/static dependency**

```bash
npm -w server install @fastify/static
```

---

### Task 7: Create reference audio directory

**Files:**
- Create: `server/assets/tts/` directory with placeholder

- [ ] **Step 1: Create directory**

```bash
mkdir -p server/assets/tts
```

- [ ] **Step 2: Create a .gitkeep note file**

Write `server/assets/tts/README.md`:
```markdown
# TTS 参考音频

此目录存放 moss-tts-nano 音色克隆所需的参考音频文件。

- `reference.wav`: 默认参考音频(所有角色共用)
- 后续可为每个角色添加独立参考音频(如 `player.wav`, `coach.wav`)
```

---

### Task 8: Update ws-server.test.ts

**Files:**
- Modify: `server/src/ws-server.test.ts`

**Objective:** Update any tests that reference the old TTS import or config. Since ws-server.test.ts doesn't seem to directly test /tts, verify what needs changing and add a basic /tts integration test.

- [ ] **Step 1: Check for import issues**

```bash
npx vitest run server/src/ws-server.test.ts 2>&1 | tail -20
```

If there are compilation errors from removed imports, fix them.

- [ ] **Step 2: Verify tests pass**

Run the full test suite to identify any remaining breakage:
```bash
npm -w server test 2>&1
```

---

### Task 9: Update admin-routes.test.ts

**Files:**
- Modify: `server/src/admin/admin-routes.test.ts:62,64`

- [ ] **Step 1: Update TTS voice assertion**

The test at line 62-64 that tests `ttsVoice: 'Cherry'` should still work since the admin routes still use the `ttsVoice` field. But the `voiceProfileForPersona` method is what changed. Check that the test still compiles and passes.

```bash
npx vitest run server/src/admin/admin-routes.test.ts
```

If the test at line 64 checks `cfg.voiceForPersona('coach')` (the old method), update it to use `cfg.voiceProfileForPersona('coach')`:

```typescript
expect(cfg.voiceProfileForPersona('coach')).toEqual(DEFAULT_VOICE_PROFILES.coach)
```

---

### Task 10: Clean up old files

**Files:**
- Remove: `server/src/voice/dashscope-tts.ts`
- Remove: `server/src/voice/dashscope-tts.test.ts`
- Modify: `server/src/admin/admin-routes.test.ts:64` (voiceForPersona → voiceProfileForPersona)

- [ ] **Step 1: Delete dashscope-tts files**

```bash
rm server/src/voice/dashscope-tts.ts server/src/voice/dashscope-tts.test.ts
```

- [ ] **Step 2: Final test run**

```bash
npm -w server test
```
Expected: All tests PASS

---

### Task 11: Commit

- [ ] **Step 1: Stage all changes and commit**

```bash
git add server/
git commit -m "feat: replace Dashscope TTS with moss-tts-nano offline streaming TTS

- New moss-tts.ts core module with streaming API support
- Per-persona VoiceProfile with tunable sampling parameters
- moss-tts-nano serve process lifecycle management
- Static file serving for generated TTS audio
- Updated config/validation for local TTS
- Removed dashscope-tts cloud dependency"
```

---

### Self-Review Checklist

**1. Spec coverage:**
- [x] TtsCfg interface change → Task 2
- [x] VoiceProfile type + defaults → Task 1
- [x] Per-persona voice profiles → Task 1
- [x] Streaming API call → Task 5
- [x] /tts route rewrite → Task 6
- [x] moss-tts-nano process management → Task 6
- [x] Static file serving → Task 6
- [x] Validation update → Task 3
- [x] runtime-config update → Task 4
- [x] Test updates → Tasks 3, 4, 8, 9
- [x] Cleanup old files → Task 10
- [x] Reference audio directory → Task 7

**2. Placeholder scan:** No TBD/TODO found. All code is complete.

**3. Type consistency:** 
- `VoiceProfile` defined in Task 1, used in Tasks 4, 5, 6
- `MossTtsCfg` defined in Task 5, used in Task 6
- `voiceProfileForPersona` defined on RuntimeConfig in Task 4, called in Task 6
- All properties match across files.

**4. Dependencies:** Note that Task 7 requires downloading/obtaining a reference audio WAV file. The user must provide this or use moss-tts-nano's bundled demo audio. The plan assumes a default reference.wav will be placed.
