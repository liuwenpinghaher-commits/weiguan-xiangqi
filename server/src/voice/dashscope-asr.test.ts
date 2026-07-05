import { describe, it, expect, afterEach } from 'vitest'
import { DashscopeAsr, dashscopeAsrCreds } from './dashscope-asr.js'

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

describe('dashscopeAsrCreds(只认 DASHSCOPE env,不碰 chat 模型凭据)', () => {
  // 每条 it 都显式设置自己需要的 env,故无条件 delete 即可清场。
  // 注意:不能用 `process.env.X = savedValue` 恢复——savedValue 为 undefined 时
  // Node 会把变量设成字符串 "undefined"(真值),毒化后续测试文件的凭据判断。
  afterEach(() => {
    delete process.env.DASHSCOPE_API_KEY
    delete process.env.DASHSCOPE_BASE_URL
  })
  it('两个 env 都在 → 返回凭据', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-bailian'
    process.env.DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    expect(dashscopeAsrCreds()).toEqual({ apiKey: 'sk-bailian', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1' })
  })
  it('缺 key → null', () => {
    delete process.env.DASHSCOPE_API_KEY
    process.env.DASHSCOPE_BASE_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1'
    expect(dashscopeAsrCreds()).toBeNull()
  })
  it('缺 baseURL → null', () => {
    process.env.DASHSCOPE_API_KEY = 'sk-bailian'
    delete process.env.DASHSCOPE_BASE_URL
    expect(dashscopeAsrCreds()).toBeNull()
  })
})
