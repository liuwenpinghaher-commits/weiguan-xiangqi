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

const OFFLINE_CHAT_REPLIES = [
  '当头炮架得有章法，正所谓宁失一子不失一先，先把中路镇住！',
  '这步棋进退有据，马走日象走田，阵型护得很稳当。',
  '一车十子寒，先把大子亮出来抢占要道才是正理。',
  '小卒过河当小车，中盘子力协同看着挺有嚼头。',
  '这手棋守中带攻，看对方怎么接招了。',
  '棋局有来有回，稳扎稳打别急着贪子。',
]
let offlineReplyIdx = 0

function createOfflineFallbackLlm(): FakeLLM {
  return new FakeLLM((messages) => {
    const sys = messages[0]?.content ?? ''
    const user = messages[messages.length - 1]?.content ?? ''
    if (!sys.startsWith('你是「')) return ''
    if (user.includes('棋手问你:')) {
      return '结合当前盘面看，建议先出动车马大子占住肋道，稳固中防后再图反击。'
    }
    if (user.includes('这盘棋结束了')) {
      return '这盘棋杀得精彩，双方攻防转换很有章法，值得去诊断页复盘细品！'
    }
    const line = OFFLINE_CHAT_REPLIES[offlineReplyIdx % OFFLINE_CHAT_REPLIES.length]
    offlineReplyIdx++
    return line
  }, '')
}

/**
 * 据 llm 配置造内层 provider:
 * - baseURL 指向本机 → OllamaLLM(本地,思考型模型靠 /api/chat 的 think 开关;无需 apiKey)
 * - 有 apiKey+baseURL(云) → DashscopeLLM(OpenAI 兼容 /v1)
 * - 都没有 → FakeLLM(确定性离线点评降级,不崩)
 */
export function buildInnerLlm(cfg: LlmCfg): LLMProvider {
  if (cfg.baseURL && isLocalBase(cfg.baseURL)) return new OllamaLLM(cfg.model, cfg.baseURL)
  if (cfg.apiKey && cfg.baseURL) return new DashscopeLLM(cfg.model, cfg.apiKey, cfg.baseURL)
  return createOfflineFallbackLlm()
}
