import { describe, it, expect } from 'vitest'
import { MutableLLM } from './mutable-llm.js'
import { FakeLLM } from './fake.js'

describe('MutableLLM', () => {
  it('委托给当前内层 provider', async () => {
    const m = new MutableLLM(new FakeLLM(['A']))
    expect(await m.chat([{ role: 'user', content: 'hi' }])).toBe('A')
  })
  it('replace 后 chat 走新内层', async () => {
    const m = new MutableLLM(new FakeLLM(['old']))
    m.replace(new FakeLLM(['new']))
    expect(await m.chat([{ role: 'user', content: 'hi' }])).toBe('new')
  })
})
