import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import * as admin from './admin.js'

function stub(json: unknown, ok = true, status = 200) {
  return vi.fn(async (_url: string, _init?: RequestInit) => ({ ok, status, json: async () => json } as Response))
}

describe('admin client', () => {
  const orig = globalThis.fetch
  beforeEach(() => {})
  afterEach(() => { globalThis.fetch = orig })

  it('getConfig 打到 /admin/config 并返回 body', async () => {
    globalThis.fetch = stub({ chat: { maxPerMin: 12 }, personas: [] }) as any
    const cfg = await admin.getConfig()
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/config')
    expect(cfg.chat.maxPerMin).toBe(12)
  })

  it('revealLlmKey 打到 reveal 端点', async () => {
    globalThis.fetch = stub({ apiKey: 'sk-real' }) as any
    expect((await admin.revealLlmKey()).apiKey).toBe('sk-real')
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/config/llm/reveal')
  })

  it('putSection 发 PUT + JSON body', async () => {
    globalThis.fetch = stub({ ok: true }) as any
    await admin.putSection('chat', { speakThreshold: 0.8 })
    const [url, init] = (globalThis.fetch as any).mock.calls[0]
    expect(url).toBe('http://localhost:3410/admin/config/chat')
    expect(init.method).toBe('PUT')
    expect(JSON.parse(init.body)).toEqual({ speakThreshold: 0.8 })
    expect(init.headers['Content-Type']).toBe('application/json')
  })

  it('putPersona / resetPersona / updateMemory / deleteMemory / deleteGame 用对的 method+url', async () => {
    globalThis.fetch = stub({ ok: true }) as any
    await admin.putPersona('coach', { ttsVoice: 'Cherry' })
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/personas/coach')
    expect((globalThis.fetch as any).mock.calls[0][1].method).toBe('PUT')

    await admin.resetPersona('coach')
    expect((globalThis.fetch as any).mock.calls[1][0]).toBe('http://localhost:3410/admin/personas/coach/reset')
    expect((globalThis.fetch as any).mock.calls[1][1].method).toBe('POST')

    await admin.updateMemory('mem:1', { content: 'x' })
    expect((globalThis.fetch as any).mock.calls[2][0]).toBe('http://localhost:3410/admin/memory/mem%3A1')
    expect((globalThis.fetch as any).mock.calls[2][1].method).toBe('PUT')

    await admin.deleteMemory('mem:1')
    expect((globalThis.fetch as any).mock.calls[3][1].method).toBe('DELETE')

    await admin.deleteGame(7)
    expect((globalThis.fetch as any).mock.calls[4][0]).toBe('http://localhost:3410/admin/games/7')
    expect((globalThis.fetch as any).mock.calls[4][1].method).toBe('DELETE')
  })

  it('listMemory 拼 query', async () => {
    globalThis.fetch = stub([]) as any
    await admin.listMemory({ personaId: 'coach', kind: 'fact' })
    expect((globalThis.fetch as any).mock.calls[0][0]).toBe('http://localhost:3410/admin/memory?personaId=coach&kind=fact')
  })

  it('非 2xx 抛错', async () => {
    globalThis.fetch = stub({ error: 'bad' }, false, 400) as any
    await expect(admin.getConfig()).rejects.toThrow(/400/)
  })
})
