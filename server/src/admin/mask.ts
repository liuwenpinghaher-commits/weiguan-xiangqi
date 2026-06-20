/** key 脱敏:保留前 3 后 4,中间 ****;过短全打码;空值返回空串。 */
export function maskKey(key: string | null | undefined): string {
  if (!key) return ''
  if (key.length <= 7) return '****'
  return `${key.slice(0, 3)}****${key.slice(-4)}`
}
