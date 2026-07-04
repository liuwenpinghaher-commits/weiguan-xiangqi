export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

export interface LLMOpts {
  /** 生成 token 上限。高频弹幕用小值省 token;诊断/反思可放大 */
  maxTokens?: number
  temperature?: number
  /** 仅本地 Ollama(OllamaLLM)识别:开/关 Qwen3 系思考。默认关(弹幕快);
   *  诊断/反思传 true 发挥推理。云 provider(DashscopeLLM)忽略此项。 */
  think?: boolean
}

export interface LLMProvider {
  /** 返回纯文本回复(只取 content,忽略 reasoning_content) */
  chat(messages: ChatMsg[], opts?: LLMOpts): Promise<string>
}
