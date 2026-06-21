import { describe, it, expect } from 'vitest'
import { FakeAsr } from './asr.js'

describe('FakeAsr', () => {
  it('返回构造时给定的固定文字', async () => {
    const asr = new FakeAsr('当头炮,马来跳')
    expect(await asr.transcribe(Buffer.from('x'), 'audio/wav')).toBe('当头炮,马来跳')
  })
  it('可用函数自定义返回(便于断言收到的 mime)', async () => {
    const asr = new FakeAsr((_audio, mime) => `mime=${mime}`)
    expect(await asr.transcribe(Buffer.from('x'), 'audio/wav')).toBe('mime=audio/wav')
  })
})
