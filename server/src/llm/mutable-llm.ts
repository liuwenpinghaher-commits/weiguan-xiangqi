import type { LLMProvider, ChatMsg, LLMOpts } from './provider.js'
import { DashscopeLLM } from './dashscope.js'
import { OllamaLLM } from './ollama.js'
import { FakeLLM } from './fake.js'
import type { LlmCfg } from '../config/defaults.js'

/** 持有可替换内层 provider 的包装器:改 LLM 配置时 replace 内层,上层(ChatEngine/reflect)无感。 */
export class MutableLLM implements LLMProvider {
  constructor(private inner: LLMProvider) {}
  replace(inner: LLMProvider): void { this.inner = inner }
  chat(messages: ChatMsg[], opts?: LLMOpts): Promise<string> { return this.inner.chat(messages, opts) }
}

/** baseURL 指向本机 = 本地 Ollama(走 /api/chat,可开关 think);否则 OpenAI 兼容云端。 */
export function isLocalBase(url: string): boolean { return /localhost|127\.0\.0\.1|\[::1\]/.test(url) }

/** 该 LLM 配置能否造出可用 provider(否则 buildInnerLlm 落 FakeLLM,chat 全空串)。 */
export function llmUsable(cfg: LlmCfg): boolean {
  return !!cfg.baseURL && (isLocalBase(cfg.baseURL) || !!cfg.apiKey)
}

/**
 * 据 llm 配置造内层 provider:
 * - baseURL 指向本机 → OllamaLLM(本地,思考型模型靠 /api/chat 的 think 开关;无需 apiKey)
 * - 有 apiKey+baseURL(云) → DashscopeLLM(OpenAI 兼容 /v1)
 * - 都没有 → FakeLLM(占位,不崩)
 */
export function buildInnerLlm(cfg: LlmCfg): LLMProvider {
  if (cfg.baseURL && isLocalBase(cfg.baseURL)) return new OllamaLLM(cfg.model, cfg.baseURL)
  if (cfg.apiKey && cfg.baseURL) return new DashscopeLLM(cfg.model, cfg.apiKey, cfg.baseURL)
  return new FakeLLM([], '')
}
