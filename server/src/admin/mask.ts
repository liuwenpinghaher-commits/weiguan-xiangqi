/** key 脱敏:足够长(>11)才露前 3 后 4,中间 ****;较短的只露前 1 后 1;过短/空全打码。 */
export function maskKey(key: string | null | undefined): string {
  if (!key) return ''
  // >11:前 3 后 4 之间至少遮 5 位,不会露出大半 key
  if (key.length > 11) return `${key.slice(0, 3)}****${key.slice(-4)}`
  // 8~11:只露前 1 后 1,中间全遮(原先 length=8 时露 7/8 太多)
  if (key.length > 4) return `${key.slice(0, 1)}****${key.slice(-1)}`
  // <=4:全打码
  return '****'
}
