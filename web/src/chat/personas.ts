// 角色显示名/配色的单一来源:ChatPanel(直播弹幕)与 ReviewPage(观众席回放)都从这里取,
// 避免两处硬编码各自漂移。
//
// TODO(P3-29): 后端 chat/message 帧只带 personaId,不带角色名;控制台 PersonasTab 改的 name 落库后
//   前端仍用本表硬编码渲染 → 改名不生效。若要让控制台改名生效,需前端从 /admin/config(或 personas
//   接口)拉取 id→name 映射后覆盖本表。当前为最小风险起见保持硬编码。
export const PERSONA_NAMES: Record<string, string> = {
  player: '老黑',
  laopaoer: '炮儿爷',
  coach: '林教练',
  netizen: '吃瓜阿强',
  human: '你',
}

export const PERSONA_COLORS: Record<string, string> = {
  player: '#e74c3c',
  laopaoer: '#e67e22',
  coach: '#27ae60',
  netizen: '#2980b9',
}

export function personaName(personaId: string): string {
  return PERSONA_NAMES[personaId] ?? personaId
}
