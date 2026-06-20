import { VolcanoLLM } from '../src/llm/volcano.js'

const llm = new VolcanoLLM()
const banter = await llm.chat(
  [
    { role: 'system', content: '你是毒舌懂棋的中国象棋老棋友,一句话≤25字。' },
    { role: 'user', content: '我走了当头炮,损我一句。' },
  ],
  { disableThinking: true, maxTokens: 80 },
)
console.log('弹幕:', banter)
