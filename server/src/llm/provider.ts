export interface ChatMsg { role: 'system' | 'user' | 'assistant'; content: string }

export interface LLMOpts {
  /** 关推理(高频弹幕用,省 token);诊断/反思置 false 开推理 */
  maxTokens?: number
  temperature?: number
}

export interface LLMProvider {
  /** 返回纯文本回复(只取 content,忽略 reasoning_content) */
  chat(messages: ChatMsg[], opts?: LLMOpts): Promise<string>
}
