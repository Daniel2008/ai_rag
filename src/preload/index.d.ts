import type { KnowledgeBaseSnapshot } from '../types/files'

export interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
}

export type ModelProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek' | 'zhipu' | 'moonshot'

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  chatModel: string
  embeddingModel?: string
}

export type EmbeddingProvider = 'local' | 'ollama'

export interface AppSettings {
  provider: ModelProvider
  ollama: ProviderConfig
  openai: ProviderConfig
  anthropic: ProviderConfig
  deepseek: ProviderConfig
  zhipu: ProviderConfig
  moonshot: ProviderConfig
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  ollamaUrl: string
}

export interface EmbeddingProgress {
  status: 'downloading' | 'loading' | 'ready' | 'error'
  progress?: number
  file?: string
  message?: string
}

export interface ProcessFileResult {
  success: boolean
  count?: number
  preview?: string
  error?: string
}

export interface ChatMessage {
  key: string
  role: 'user' | 'ai' | 'system'
  content: string
  sources?: ChatSource[]
  timestamp?: number
  status?: string
  typing?: boolean
}

// 自定义 ElectronAPI 类型
export interface ElectronAPI {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => void
    on: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => () => void
    once: (channel: string, listener: (event: unknown, ...args: unknown[]) => void) => void
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    removeAllListeners: (channel: string) => void
  }
  process: {
    platform: string
    versions: NodeJS.ProcessVersions
  }
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      // 窗口控制
      minimizeWindow: () => void
      maximizeWindow: () => void
      closeWindow: () => void
      isWindowMaximized: () => Promise<boolean>
      onMaximizedChange: (callback: (isMaximized: boolean) => void) => () => void
      platform: string
      
      selectFile: () => Promise<string | null>
      processFile: (path: string) => Promise<ProcessFileResult>
      chat: (payload: { question: string; sources?: string[] }) => void
      getKnowledgeBase: () => Promise<KnowledgeBaseSnapshot>
      removeIndexedFile: (filePath: string) => Promise<KnowledgeBaseSnapshot>
      reindexIndexedFile: (filePath: string) => Promise<KnowledgeBaseSnapshot>
      createCollection: (payload: {
        name: string
        description?: string
        files?: string[]
      }) => Promise<KnowledgeBaseSnapshot>
      updateCollection: (payload: {
        id: string
        name?: string
        description?: string
        files?: string[]
      }) => Promise<KnowledgeBaseSnapshot>
      deleteCollection: (collectionId: string) => Promise<KnowledgeBaseSnapshot>
      onChatToken: (callback: (token: string) => void) => void
      onChatSources: (callback: (sources: ChatSource[]) => void) => void
      onChatDone: (callback: () => void) => void
      onChatError: (callback: (error: string) => void) => void
      removeAllChatListeners: () => void
      // 嵌入模型进度
      onEmbeddingProgress: (callback: (progress: EmbeddingProgress) => void) => void
      removeEmbeddingProgressListener: () => void
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean; embeddingChanged?: boolean }>

      // Database APIs
      getConversations: () => Promise<{ key: string; label: string; timestamp: number }[]>
      createConversation: (key: string, label: string) => Promise<void>
      deleteConversation: (key: string) => Promise<void>
      getMessages: (
        conversationKey: string,
        limit?: number,
        offset?: number
      ) => Promise<ChatMessage[]>
      saveMessage: (conversationKey: string, message: ChatMessage) => Promise<void>
      updateMessage: (messageKey: string, updates: Partial<ChatMessage>) => Promise<void>
      generateTitle: (conversationKey: string, question: string, answer: string) => Promise<string>
    }
  }
}
