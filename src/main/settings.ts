import ElectronStore from 'electron-store'
import type {
  AppSettings,
  ModelProvider,
  ProviderConfig,
  EmbeddingProvider,
  RagSettings
} from '../types/chat'

export type { AppSettings, ModelProvider, ProviderConfig, EmbeddingProvider, RagSettings }

const defaults: AppSettings = {
  provider: 'ollama',
  ollama: {
    baseUrl: 'http://localhost:11434',
    chatModel: 'qwen2.5:7b'
  },
  openai: {
    apiKey: '',
    baseUrl: 'https://api.openai.com/v1',
    chatModel: 'gpt-4o-mini'
  },
  anthropic: {
    apiKey: '',
    baseUrl: 'https://api.anthropic.com',
    chatModel: 'claude-3-5-sonnet-20241022'
  },
  deepseek: {
    apiKey: '',
    baseUrl: 'https://api.deepseek.com',
    chatModel: 'deepseek-chat'
  },
  zhipu: {
    apiKey: '',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    chatModel: 'glm-4-flash'
  },
  moonshot: {
    apiKey: '',
    baseUrl: 'https://api.moonshot.cn/v1',
    chatModel: 'moonshot-v1-8k'
  },
  embeddingProvider: 'local',
  embeddingModel: 'multilingual-e5-small', // 默认使用多语言模型以支持跨语言检索
  ollamaUrl: 'http://localhost:11434',
  rag: {
    searchLimit: 6,
    maxSearchLimit: 30,
    minRelevance: 0.25,
    useRerank: false,
    useMultiQuery: false,
    useWebSearch: false,
    tavilyApiKey: ''
  }
}

const StoreConstructor = ((ElectronStore as unknown as { default?: typeof ElectronStore })
  .default ?? ElectronStore) as typeof ElectronStore

const storeConfig: Record<string, unknown> = {
  name: 'ai-rag-settings',
  projectName: 'ai-rag-app',
  defaults
}
const store = new (StoreConstructor as new (
  config: Record<string, unknown>
) => ElectronStore<AppSettings>)(storeConfig)

function normalizeEndpoint(input: unknown): string | undefined {
  if (typeof input !== 'string') return undefined
  let s = input.trim()
  while (true) {
    const next = s
      .replace(/^[`"'“”‘’]+/, '')
      .replace(/[`"'“”‘’]+$/, '')
      .trim()
    if (next === s) break
    s = next
  }
  if (!s) return ''
  if (s.endsWith('/')) return s.replace(/\/+$/, '')
  return s
}

function normalizeRagSettings(
  input: Partial<RagSettings> | undefined,
  base: RagSettings
): RagSettings {
  const searchLimitRaw =
    typeof input?.searchLimit === 'number' ? input.searchLimit : base.searchLimit
  const maxSearchLimitRaw =
    typeof input?.maxSearchLimit === 'number' ? input.maxSearchLimit : base.maxSearchLimit
  const minRelevanceRaw =
    typeof input?.minRelevance === 'number' ? input.minRelevance : base.minRelevance

  const searchLimit = Number.isFinite(searchLimitRaw)
    ? Math.max(1, Math.round(searchLimitRaw))
    : base.searchLimit
  const maxSearchLimit = Number.isFinite(maxSearchLimitRaw)
    ? Math.max(searchLimit, Math.round(maxSearchLimitRaw))
    : Math.max(searchLimit, base.maxSearchLimit)
  const minRelevance = Number.isFinite(minRelevanceRaw)
    ? Math.min(1, Math.max(0, minRelevanceRaw))
    : base.minRelevance

  const useRerank = typeof input?.useRerank === 'boolean' ? input.useRerank : base.useRerank
  const useMultiQuery =
    typeof input?.useMultiQuery === 'boolean' ? input.useMultiQuery : base.useMultiQuery
  const useWebSearch =
    typeof input?.useWebSearch === 'boolean' ? input.useWebSearch : base.useWebSearch
  const tavilyApiKey = input?.tavilyApiKey ?? base.tavilyApiKey

  return {
    searchLimit,
    maxSearchLimit,
    minRelevance,
    useRerank,
    useMultiQuery,
    useWebSearch,
    tavilyApiKey
  }
}

// 合并供应商配置，确保所有字段都有值
function mergeProviderConfig(
  stored: Partial<ProviderConfig> | undefined,
  defaultConfig: ProviderConfig
): ProviderConfig {
  if (!stored) return defaultConfig
  return {
    apiKey: typeof stored.apiKey === 'string' ? stored.apiKey.trim() : defaultConfig.apiKey,
    baseUrl:
      normalizeEndpoint(stored.baseUrl) ??
      normalizeEndpoint(defaultConfig.baseUrl) ??
      defaultConfig.baseUrl,
    chatModel: stored.chatModel ?? defaultConfig.chatModel,
    embeddingModel: stored.embeddingModel ?? defaultConfig.embeddingModel
  }
}

export function getSettings(): AppSettings {
  const provider = store.get('provider') || defaults.provider
  const openaiStored = store.get('openai')
  const deepseekStored = store.get('deepseek')

  return {
    provider,
    ollama: mergeProviderConfig(store.get('ollama'), defaults.ollama),
    openai: mergeProviderConfig(openaiStored, defaults.openai),
    anthropic: mergeProviderConfig(store.get('anthropic'), defaults.anthropic),
    deepseek: mergeProviderConfig(deepseekStored, defaults.deepseek),
    zhipu: mergeProviderConfig(store.get('zhipu'), defaults.zhipu),
    moonshot: mergeProviderConfig(store.get('moonshot'), defaults.moonshot),
    embeddingProvider: store.get('embeddingProvider') || defaults.embeddingProvider,
    embeddingModel: store.get('embeddingModel') || defaults.embeddingModel,
    ollamaUrl: normalizeEndpoint(store.get('ollamaUrl')) ?? defaults.ollamaUrl,
    rag: normalizeRagSettings(store.get('rag'), defaults.rag)
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) {
      if (key === 'rag' && typeof value === 'object' && value) {
        const existing = store.get('rag')
        const merged = { ...defaults.rag, ...(existing ?? {}), ...(value as Partial<RagSettings>) }
        store.set('rag', normalizeRagSettings(merged, defaults.rag))
      } else if (
        typeof value === 'object' &&
        value !== null &&
        ['openai', 'anthropic', 'deepseek', 'zhipu', 'moonshot', 'ollama'].includes(key)
      ) {
        // 自动修剪 API Key 和 Base URL 的空格
        const config = { ...(value as unknown as Record<string, unknown>) }
        if (typeof config['apiKey'] === 'string') config['apiKey'] = config['apiKey'].trim()
        if (typeof config['baseUrl'] === 'string') {
          config['baseUrl'] = normalizeEndpoint(config['baseUrl']) ?? ''
        }
        store.set(key as keyof AppSettings, config)
      } else if (key === 'ollamaUrl' && typeof value === 'string') {
        store.set(key as keyof AppSettings, normalizeEndpoint(value) ?? '')
      } else {
        store.set(key as keyof AppSettings, value)
      }
    }
  }
}

// 获取当前供应商配置
export function getCurrentProviderConfig(): ProviderConfig & { provider: ModelProvider } {
  const settings = getSettings()
  const providerConfig = settings[settings.provider] as ProviderConfig
  return {
    ...providerConfig,
    provider: settings.provider
  }
}
