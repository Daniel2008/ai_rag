import { getSettings, type ModelProvider } from '../settings'
import type { ProviderConfig } from '../../types/chat'

type AvailabilityResult =
  | { ok: true; provider: ModelProvider; baseUrl: string }
  | { ok: false; provider: ModelProvider; baseUrl: string; message: string; code?: string }

const cache = new Map<
  string,
  {
    ok: boolean
    ts: number
    provider: ModelProvider
    baseUrl: string
    message?: string
    code?: string
  }
>()

const OK_TTL_MS = 30_000
const FAIL_TTL_MS = 5_000
const DEFAULT_TIMEOUT_MS = 2_000

function providerLabel(provider: ModelProvider): string {
  switch (provider) {
    case 'ollama':
      return 'Ollama'
    case 'openai':
      return 'OpenAI'
    case 'anthropic':
      return 'Anthropic'
    case 'deepseek':
      return 'DeepSeek'
    case 'zhipu':
      return '智谱'
    case 'moonshot':
      return 'Moonshot'
    default:
      return provider
  }
}

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/, '')
  const p = path.startsWith('/') ? path : `/${path}`
  return `${b}${p}`
}

function isHttpUrl(input: string): boolean {
  try {
    const u = new URL(input)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

function extractNetworkCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') return undefined
  const anyErr = error as Record<string, unknown>

  const directCode = anyErr['code']
  if (typeof directCode === 'string') return directCode

  const cause = anyErr['cause']
  if (cause && typeof cause === 'object') {
    const causeCode = (cause as Record<string, unknown>)['code']
    if (typeof causeCode === 'string') return causeCode

    const errors = (cause as Record<string, unknown>)['errors']
    if (Array.isArray(errors)) {
      for (const e of errors) {
        if (e && typeof e === 'object') {
          const c = (e as Record<string, unknown>)['code']
          if (typeof c === 'string') return c
        }
      }
    }
  }

  const errors = anyErr['errors']
  if (Array.isArray(errors)) {
    for (const e of errors) {
      if (e && typeof e === 'object') {
        const c = (e as Record<string, unknown>)['code']
        if (typeof c === 'string') return c
      }
    }
  }

  return undefined
}

function buildUnreachableMessage(provider: ModelProvider, baseUrl: string, code?: string): string {
  const label = providerLabel(provider)

  if (provider === 'ollama') {
    const prefix = code ? `（${code}）` : ''
    return `无法连接到 ${label} 服务${prefix}：${baseUrl}。请确认 Ollama 已启动且服务地址/端口正确。`
  }

  const prefix = code ? `（${code}）` : ''
  return `无法连接到 ${label} 接口${prefix}：${baseUrl}。请检查 API 地址、网络/代理设置，或稍后重试。`
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(url, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function getProviderBaseUrl(provider: ModelProvider): string {
  const settings = getSettings()
  if (provider === 'ollama') {
    return (settings.ollamaUrl || settings.ollama.baseUrl || '').trim()
  }
  const config = settings[provider] as ProviderConfig
  return (config?.baseUrl ?? '').trim()
}

function buildProbeUrl(provider: ModelProvider, baseUrl: string): string {
  if (provider === 'ollama') return joinUrl(baseUrl, '/api/version')
  if (provider === 'anthropic') return baseUrl
  return joinUrl(baseUrl, '/models')
}

function buildProbeHeaders(provider: ModelProvider): HeadersInit | undefined {
  const settings = getSettings()
  if (provider === 'ollama') return undefined

  const config = settings[provider] as ProviderConfig
  const apiKey = (config?.apiKey ?? '').trim()
  if (!apiKey) return undefined

  if (provider === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    }
  }

  return {
    Authorization: `Bearer ${apiKey}`
  }
}

export async function checkProviderAvailable(
  provider?: ModelProvider,
  options?: { timeoutMs?: number }
): Promise<AvailabilityResult> {
  const settings = getSettings()
  const actualProvider = provider ?? settings.provider
  const baseUrl = getProviderBaseUrl(actualProvider)
  const cacheKey = `${actualProvider}|${baseUrl}`

  const cached = cache.get(cacheKey)
  if (cached) {
    const ttl = cached.ok ? OK_TTL_MS : FAIL_TTL_MS
    if (Date.now() - cached.ts <= ttl) {
      return cached.ok
        ? { ok: true, provider: cached.provider, baseUrl: cached.baseUrl }
        : {
            ok: false,
            provider: cached.provider,
            baseUrl: cached.baseUrl,
            message:
              cached.message ||
              buildUnreachableMessage(cached.provider, cached.baseUrl, cached.code),
            code: cached.code
          }
    }
  }

  if (!baseUrl) {
    const message =
      actualProvider === 'ollama'
        ? '未配置 Ollama 服务地址，请在设置中填写（例如 http://localhost:11434）。'
        : `未配置 ${providerLabel(actualProvider)} API 地址，请在设置中填写。`
    const res: AvailabilityResult = { ok: false, provider: actualProvider, baseUrl: '', message }
    cache.set(cacheKey, {
      ok: false,
      ts: Date.now(),
      provider: actualProvider,
      baseUrl: '',
      message
    })
    return res
  }

  if (!isHttpUrl(baseUrl)) {
    const message =
      actualProvider === 'ollama'
        ? `Ollama 服务地址格式不正确：${baseUrl}。请使用 http(s):// 开头的地址。`
        : `${providerLabel(actualProvider)} API 地址格式不正确：${baseUrl}。请使用 http(s):// 开头的地址。`
    const res: AvailabilityResult = { ok: false, provider: actualProvider, baseUrl, message }
    cache.set(cacheKey, { ok: false, ts: Date.now(), provider: actualProvider, baseUrl, message })
    return res
  }

  const url = buildProbeUrl(actualProvider, baseUrl)
  const headers = buildProbeHeaders(actualProvider)
  try {
    await fetchWithTimeout(
      url,
      {
        method: 'GET',
        headers
      },
      options?.timeoutMs ?? DEFAULT_TIMEOUT_MS
    )
    cache.set(cacheKey, { ok: true, ts: Date.now(), provider: actualProvider, baseUrl })
    return { ok: true, provider: actualProvider, baseUrl }
  } catch (error) {
    const code = extractNetworkCode(error)
    const message = buildUnreachableMessage(actualProvider, baseUrl, code)
    cache.set(cacheKey, {
      ok: false,
      ts: Date.now(),
      provider: actualProvider,
      baseUrl,
      message,
      code
    })
    return { ok: false, provider: actualProvider, baseUrl, message, code }
  }
}

export async function ensureProviderAvailable(
  provider?: ModelProvider,
  options?: { timeoutMs?: number }
): Promise<void> {
  const res = await checkProviderAvailable(provider, options)
  if (!res.ok) throw new Error(res.message)
}
