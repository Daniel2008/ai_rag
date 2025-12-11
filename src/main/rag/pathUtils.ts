export function normalizePath(p: string): string {
  if (!p) return p
  // 将反斜杠统一为正斜杠，并小写化，以便跨平台比较
  return p.replace(/\\/g, '/').toLowerCase()
}

export function isUrlPath(p: string): boolean {
  return /^https?:\/\//i.test(p)
}
