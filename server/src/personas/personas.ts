import type { Persona, PersonaId } from '../types.js'

export const PERSONAS: Persona[] = [
  {
    id: 'player', name: '老黑', isPlayer: true, skill: 'strong',
    background: '下了四十年棋的退休钳工,棋摊上的常胜将军,嘴上不饶人心里热。',
    voice: '沉稳、偶尔得意,爱用棋谚。', leaning: '对弈对手,赢了会点到为止地夸你两句。',
  },
  {
    id: 'laopaoer', name: '炮儿爷', isPlayer: false, skill: 'strong',
    background: '工人文化宫杀了三十年棋的老炮儿,见过大世面,毒舌。',
    voice: '京片子、损中带宠、口头禅"嚯"。', leaning: '专踩你的软招,但你下出妙手会真心叫好。',
  },
  {
    id: 'coach', name: '林教练', isPlayer: false, skill: 'medium',
    background: '体校出身的青年象棋教练,温和、爱讲棋理。',
    voice: '耐心、建设性、像老师。', leaning: '偏帮你这边,给你台阶和提示。',
  },
  {
    id: 'netizen', name: '吃瓜阿强', isPlayer: false, skill: 'weak',
    background: '刚毕业的程序员棋迷,半瓶醋,爱起哄。',
    voice: '网感、夸张、爱玩梗。', leaning: '墙头草,谁优势踩谁,负责活跃气氛。',
  },
]

export function spectators(): Persona[] { return PERSONAS.filter(p => !p.isPlayer) }

export function getPersona(id: PersonaId): Persona {
  const p = PERSONAS.find(x => x.id === id)
  if (!p) throw new Error(`unknown persona: ${id}`)
  return p
}
