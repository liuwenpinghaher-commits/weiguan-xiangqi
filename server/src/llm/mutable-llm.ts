import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'
import { DashscopeLLM } from './dashscope.js'
import { FakeLLM } from './fake.js'
import type { LlmCfg } from '../config/defaults.js'

/** 持有可替换内层 provider 的包装器:改 LLM 配置时 replace 内层,上层(ChatEngine/reflect)无感。 */
export class MutableLLM implements LLMProvider {
  constructor(private inner: LLMProvider) {}
  replace(inner: LLMProvider): void { this.inner = inner }
  chat(messages: ChatMsg[], opts?: LLMOpts): Promise<string> { return this.inner.chat(messages, opts) }
}

/** 据 llm 配置造内层:有 apiKey+baseURL → DashscopeLLM;否则 FakeLLM(占位,不崩)。 */
export function buildInnerLlm(cfg: LlmCfg): LLMProvider {
  if (cfg.apiKey && cfg.baseURL) return new DashscopeLLM(cfg.model, cfg.apiKey, cfg.baseURL)
  return new FakeLLM([], '')
}
