import ElectronStore from 'electron-store'

export interface AppSettings {
  ollamaUrl: string
  chatModel: string
  embeddingModel: string
}

const defaults: AppSettings = {
  ollamaUrl: 'http://localhost:11434',
  chatModel: 'qwen2.5:7b',
  embeddingModel: 'nomic-embed-text'
}

const StoreConstructor = (
  (ElectronStore as unknown as { default?: typeof ElectronStore }).default ?? ElectronStore
) as typeof ElectronStore

const storeConfig: Record<string, unknown> = {
  name: 'ai-rag-settings',
  projectName: 'ai-rag-app',
  defaults
}
const store = new (StoreConstructor as new (config: Record<string, unknown>) => ElectronStore<AppSettings>)(storeConfig)

export function getSettings(): AppSettings {
  return {
    ollamaUrl: store.get('ollamaUrl'),
    chatModel: store.get('chatModel'),
    embeddingModel: store.get('embeddingModel')
  }
}

export function saveSettings(settings: Partial<AppSettings>): void {
  if (settings.ollamaUrl !== undefined) {
    store.set('ollamaUrl', settings.ollamaUrl)
  }
  if (settings.chatModel !== undefined) {
    store.set('chatModel', settings.chatModel)
  }
  if (settings.embeddingModel !== undefined) {
    store.set('embeddingModel', settings.embeddingModel)
  }
}
