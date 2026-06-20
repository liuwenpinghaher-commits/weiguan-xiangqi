import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'

type Responder = string[] | ((messages: ChatMsg[], opts?: LLMOpts) => string)

export class FakeLLM implements LLMProvider {
  calls: { messages: ChatMsg[]; opts?: LLMOpts }[] = []
  private queue: string[] | null
  private fn: ((m: ChatMsg[], o?: LLMOpts) => string) | null
  constructor(private responder: Responder = [], private fallback = '') {
    this.queue = Array.isArray(responder) ? [...responder] : null
    this.fn = typeof responder === 'function' ? responder : null
  }
  async chat(messages: ChatMsg[], opts?: LLMOpts): Promise<string> {
    this.calls.push({ messages, opts })
    if (this.fn) return this.fn(messages, opts)
    if (this.queue && this.queue.length > 0) return this.queue.shift()!
    return this.fallback
  }
}
