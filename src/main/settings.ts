import ElectronStore from 'electron-store'

export type ModelProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek' | 'zhipu' | 'moonshot'

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  chatModel: string
  embeddingModel?: string
}

export interface AppSettings {
  // 当前选择的供应商
  provider: ModelProvider
  // Ollama 设置（本地）
  ollama: ProviderConfig
  // OpenAI 设置
  openai: ProviderConfig
  // Anthropic (Claude) 设置
  anthropic: ProviderConfig
  // DeepSeek 设置
  deepseek: ProviderConfig
  // 智谱 AI 设置
  zhipu: ProviderConfig
  // Moonshot (Kimi) 设置
  moonshot: ProviderConfig
  // 向量模型设置（统一使用 Ollama 本地）
  embeddingProvider: 'ollama'
  embeddingModel: string
  ollamaUrl: string
}

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
  embeddingProvider: 'ollama',
  embeddingModel: 'nomic-embed-text',
  ollamaUrl: 'http://localhost:11434'
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

export function getSettings(): AppSettings {
  return {
    provider: store.get('provider') || defaults.provider,
    ollama: store.get('ollama') || defaults.ollama,
    openai: store.get('openai') || defaults.openai,
    anthropic: store.get('anthropic') || defaults.anthropic,
    deepseek: store.get('deepseek') || defaults.deepseek,
    zhipu: store.get('zhipu') || defaults.zhipu,
    moonshot: store.get('moonshot') || defaults.moonshot,
    embeddingProvider: store.get('embeddingProvider') || defaults.embeddingProvider,
    embeddingModel: store.get('embeddingModel') || defaults.embeddingModel,
    ollamaUrl: store.get('ollamaUrl') || defaults.ollamaUrl
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  for (const [key, value] of Object.entries(settings)) {
    if (value !== undefined) {
      store.set(key as keyof AppSettings, value)
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
