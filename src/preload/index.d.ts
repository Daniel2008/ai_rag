import type { KnowledgeBaseSnapshot } from '../types/files'
import type {
  ChatSource,
  AppSettings,
  EmbeddingProgress,
  ProcessFileResult,
  DocumentGenerateResult,
  ChatMessage
} from '../types/chat'
/** 处理URL结果 */
export interface ProcessUrlResult {
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

      selectFiles: () => Promise<string[]>
      processFile: (path: string | string[]) => Promise<ProcessFileResult>
      processUrl: (url: string) => Promise<{
        success: boolean
        count?: number
        title?: string
        preview?: string
        error?: string
      }>
      chat: (payload: {
        conversationKey: string
        question: string
        sources?: string[]
        tags?: string[]
      }) => void
      getKnowledgeBase: () => Promise<KnowledgeBaseSnapshot>
      refreshKnowledgeBase: () => Promise<KnowledgeBaseSnapshot>
      rebuildKnowledgeBase: () => Promise<KnowledgeBaseSnapshot>
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
      onChatSuggestions: (callback: (suggestions: string[]) => void) => void
      onChatDone: (callback: () => void) => void
      onChatError: (callback: (error: string) => void) => void
      removeChatListeners: () => void
      removeAllChatListeners: () => void
      // 嵌入模型进度
      onEmbeddingProgress: (callback: (progress: EmbeddingProgress) => void) => void
      removeEmbeddingProgressListener: () => void
      getSettings: () => Promise<AppSettings>
      saveSettings: (
        settings: Partial<AppSettings>
      ) => Promise<{ success: boolean; embeddingChanged?: boolean; reindexingStarted?: boolean }>

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
      onProcessProgress: (
        callback: (progress: {
          stage: string
          percent: number
          error?: string
          taskType?: string
        }) => void
      ) => void
      removeProcessProgressListener: () => void

      // 指标读取
      getMetricsRecent: (count?: number) => Promise<
        Array<{
          message: string
          timestamp: number
          context?: string
          metadata?: Record<string, unknown>
        }>
      >

      // Update Service APIs
      checkForUpdates: () => Promise<{ success: boolean }>
      downloadUpdate: () => Promise<{ success: boolean; error?: string }>
      installUpdate: () => Promise<{ success: boolean }>
      getUpdateStatus: () => Promise<{
        isChecking: boolean
        isDownloading: boolean
        isDownloaded: boolean
        availableVersion?: string
        currentVersion: string
        error?: string
        progress?: {
          percent: number
          bytesPerSecond: number
          total: number
          transferred: number
        }
      }>
      forceCheckUpdateDev: () => Promise<{ success: boolean; message?: string }>
      onUpdateAvailable: (
        callback: (info: { version: string; releaseNotes?: string; releaseDate?: string }) => void
      ) => (() => void) | void
      onUpdateNotAvailable: (
        callback: (info: { currentVersion: string }) => void
      ) => (() => void) | void
      onDownloadProgress: (
        callback: (progress: {
          percent: number
          bytesPerSecond: number
          total: number
          transferred: number
        }) => void
      ) => (() => void) | void
      onUpdateDownloaded: (callback: (info: { version: string }) => void) => (() => void) | void
      onUpdateError: (callback: (error: { error: string }) => void) => (() => void) | void
      removeAllUpdateListeners: () => void
      onUpdateStatusChanged: (
        callback: (status: {
          isChecking: boolean
          isDownloading: boolean
          isDownloaded: boolean
          availableVersion?: string
          currentVersion: string
          error?: string
          progress?: {
            percent: number
            bytesPerSecond: number
            total: number
            transferred: number
          }
        }) => void
      ) => (() => void) | void
    }
  }
}
