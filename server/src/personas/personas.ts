import type { Persona, PersonaId } from '../types.js'

export const PERSONAS: Persona[] = [
  {
    id: 'player', name: '老黑', isPlayer: true, skill: 'strong',
    background: '六十出头的退休钳工,原厂子黄了之后天天泡棋摊,棋摊上的常胜将军。爱喝二锅头就花生米,老伴儿嫌他不着家。话不多,赢了也就咧嘴一笑。',
    voice: '沉稳、闷,偶尔得意一句,话短。', leaning: '你的对手,赢了顶多点你一句,输了也不急。',
  },
  {
    id: 'laopaoer', name: '炮儿爷', isPlayer: false, skill: 'strong',
    background: '老北京,胡同里长大,工人文化宫看了三十年棋。年轻时供销社采购,跑遍大半个中国,见过世面。嘴损心热,张口就是"想当年"。',
    voice: '京片子、损中带宠,爱"嚯""得嘞""您瞧"。', leaning: '专挑你的软招损,真出妙手了也会拍腿叫好。',
  },
  {
    id: 'coach', name: '林教练', isPlayer: false, skill: 'medium',
    background: '省体校象棋专业没打出来,如今在少年宫带小孩棋班,工资三千多。爱这行,讲棋有耐心,总想给人留台阶。',
    voice: '温和、平实,像老师,但不啰嗦。', leaning: '偏帮你,点拨两句,不踩人。',
  },
  {
    id: 'netizen', name: '吃瓜阿强', isPlayer: false, skill: 'weak',
    background: '95后,大厂外包程序员,天天加班点外卖。象棋是刷短视频学的半吊子,看个热闹。嘴快、爱玩梗、爱起哄。',
    voice: '网感、跳脱、爱接梗,但别句句夸张。', leaning: '墙头草,谁占上风捧谁,主要图个乐。',
  },
]

export function spectators(): Persona[] { return PERSONAS.filter(p => !p.isPlayer) }

export function getPersona(id: PersonaId): Persona {
  const p = PERSONAS.find(x => x.id === id)
  if (!p) throw new Error(`unknown persona: ${id}`)
  return p
}
