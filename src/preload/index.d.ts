import type { KnowledgeBaseSnapshot } from '../types/files'

export interface ChatSource {
  /** 引用内容片段 */
  content: string
  /** 文件名 */
  fileName: string
  /** 页码 */
  pageNumber?: number
  /** 完整文件路径 */
  filePath?: string
  /** 文件类型 */
  fileType?: 'pdf' | 'word' | 'text' | 'markdown' | 'url' | 'unknown'
  /** 相关度分数 (0-1) */
  score?: number
  /** 内容在文档中的位置（字符偏移） */
  position?: number
  /** 来源类型 */
  sourceType?: 'file' | 'url'
  /** URL 来源的站点名称 */
  siteName?: string
  /** URL 来源的原始链接 */
  url?: string
  /** 抓取/导入时间 */
  fetchedAt?: string
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

/** 文档类型 */
export type DocumentType = 'word' | 'ppt'

/** 文档主题风格 */
export type DocumentTheme = 'professional' | 'modern' | 'simple' | 'creative'

/** 文档生成请求 */
export interface DocumentGenerateRequest {
  type: DocumentType
  title: string
  description?: string
  sources?: string[]
  theme?: DocumentTheme
}

/** 文档生成进度 */
export interface DocumentProgress {
  stage: 'outline' | 'content' | 'generating' | 'complete' | 'error'
  percent: number
  message: string
  error?: string
}

/** 文档生成结果 */
export interface DocumentGenerateResult {
  success: boolean
  filePath?: string
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
      processUrl: (url: string) => Promise<{
        success: boolean
        count?: number
        title?: string
        preview?: string
        error?: string
      }>
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

      // Document Generation APIs
      generateDocument: (request: DocumentGenerateRequest) => Promise<DocumentGenerateResult>
      onDocumentProgress: (callback: (progress: DocumentProgress) => void) => void
      removeDocumentProgressListener: () => void
      // 文档处理进度
      onProcessProgress: (callback: (progress: { stage: string; percent: number; error?: string }) => void) => void
      removeProcessProgressListener: () => void
    }
  }
}
