import { test, expect } from 'vitest'
import { FakeLLM } from './fake.js'

test('FakeLLM 按队列依次返回,并记录收到的消息', async () => {
  const llm = new FakeLLM(['第一句', '第二句'])
  expect(await llm.chat([{ role: 'user', content: 'a' }])).toBe('第一句')
  expect(await llm.chat([{ role: 'user', content: 'b' }])).toBe('第二句')
  expect(llm.calls).toHaveLength(2)
  expect(llm.calls[1].messages[0].content).toBe('b')
})

test('FakeLLM 队列耗尽后返回默认串', async () => {
  const llm = new FakeLLM([], '兜底')
  expect(await llm.chat([{ role: 'user', content: 'x' }])).toBe('兜底')
})

test('FakeLLM 可用函数生成回复(基于输入)', async () => {
  const llm = new FakeLLM((msgs) => 'echo:' + msgs[msgs.length - 1].content)
  expect(await llm.chat([{ role: 'user', content: 'hi' }])).toBe('echo:hi')
})
