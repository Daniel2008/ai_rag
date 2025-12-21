export function normalizeHubUrl(input: string): string {
  return input.replace(/\/+$/, '')
}

export function extractResolvedFilePath(urlStr: string): string | undefined {
  try {
    const u = new URL(urlStr)
    const segments = u.pathname.split('/').filter(Boolean)
    const resolveIdx = segments.findIndex((s) => s === 'resolve')
    if (resolveIdx < 0) return undefined
    const pathStart = resolveIdx + 2
    if (pathStart >= segments.length) return undefined
    const resolved = segments.slice(pathStart).join('/')
    return resolved ? decodeURIComponent(resolved) : undefined
  } catch {
    return undefined
  }
}

export function createRetryingFetch(params: { timeoutMs: number; maxRetries: number }) {
  const { timeoutMs, maxRetries } = params

  const isRetryable = (e: unknown): boolean => {
    if (!e || typeof e !== 'object') return false
    const anyErr = e as { cause?: unknown; name?: unknown; code?: unknown; message?: unknown }
    const code =
      anyErr.code ??
      (anyErr.cause && typeof anyErr.cause === 'object'
        ? (anyErr.cause as { code?: unknown }).code
        : undefined)
    const codeStr = typeof code === 'string' ? code : ''
    if (
      codeStr === 'ECONNRESET' ||
      codeStr === 'ETIMEDOUT' ||
      codeStr === 'EAI_AGAIN' ||
      codeStr === 'ECONNREFUSED' ||
      codeStr === 'ENOTFOUND' ||
      codeStr === 'UND_ERR_CONNECT_TIMEOUT' ||
      codeStr === 'UND_ERR_HEADERS_TIMEOUT' ||
      codeStr === 'UND_ERR_BODY_TIMEOUT'
    ) {
      return true
    }
    if (anyErr.name === 'AbortError') return true
    const msg = typeof anyErr.message === 'string' ? anyErr.message : ''
    return /fetch failed/i.test(msg)
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const baseInit = init ?? {}
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      const timeout = setTimeout(() => controller.abort(), timeoutMs)
      if (baseInit.signal) {
        if (baseInit.signal.aborted) controller.abort()
        else baseInit.signal.addEventListener('abort', () => controller.abort(), { once: true })
      }

      try {
        const res = await global.fetch(input, { ...baseInit, signal: controller.signal })
        if (res.status === 429 || (res.status >= 500 && res.status <= 599)) {
          if (attempt < maxRetries) {
            console.error(
              `[Fetch] Retryable status ${res.status}, attempt ${attempt + 1}/${maxRetries}`
            )
            await res.arrayBuffer().catch(() => null)
            const backoff = Math.min(10_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 200)
            await sleep(backoff)
            continue
          }
        }
        return res
      } catch (e) {
        if (attempt < maxRetries && isRetryable(e)) {
          console.error(
            `[Fetch] Retryable error ${e instanceof Error ? e.message : String(e)}, attempt ${
              attempt + 1
            }/${maxRetries}`
          )
          const backoff = Math.min(10_000, 500 * 2 ** attempt) + Math.floor(Math.random() * 200)
          await sleep(backoff)
          continue
        }
        throw e
      } finally {
        clearTimeout(timeout)
      }
    }
    throw new Error('fetch failed')
  }
}
