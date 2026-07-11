export function weaknessText(count: number, error: string | null): string {
  if (error) return `弱点画像加载失败：${error}`
  if (count === 0) return '暂无失误样本（下几局并诊断后出现）。'
  return ''
}

export function compareText(args: { loading: boolean; reportText: string | null; error: string | null }): string {
  if (args.loading) return '加载中…'
  if (args.error) return `成长点评加载失败：${args.error}`
  return args.reportText ?? '暂无历史对比数据'
}
