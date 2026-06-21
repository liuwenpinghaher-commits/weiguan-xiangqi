import { describe, it, expect } from 'vitest'
import { DashscopeAsr } from './dashscope-asr.js'

describe('DashscopeAsr', () => {
  it('把音频组装成 input_audio data URI 调 chat.completions,并取 choices[0].message.content', async () => {
    let captured: any = null
    const fakeClient = {
      chat: { completions: { create: async (body: any) => { captured = body; return { choices: [{ message: { content: '这步不错' } }] } } } },
    }
    const asr = new DashscopeAsr('qwen3-asr-flash', 'sk-x', 'https://dashscope.aliyuncs.com/compatible-mode/v1', fakeClient as any)
    const text = await asr.transcribe(Buffer.from('hello'), 'audio/wav')
    expect(text).toBe('这步不错')
    expect(captured.model).toBe('qwen3-asr-flash')
    const part = captured.messages[0].content[0]
    expect(part.type).toBe('input_audio')
    expect(part.input_audio.data).toBe(`data:audio/wav;base64,${Buffer.from('hello').toString('base64')}`)
  })
  it('content 非字符串时返回空串', async () => {
    const fakeClient = { chat: { completions: { create: async () => ({ choices: [{ message: { content: null } }] }) } } }
    const asr = new DashscopeAsr('qwen3-asr-flash', 'sk-x', 'http://x', fakeClient as any)
    expect(await asr.transcribe(Buffer.from('x'), 'audio/wav')).toBe('')
  })
})
