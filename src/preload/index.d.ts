import type { KnowledgeBaseSnapshot } from '../types/files'

export interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
}

export interface AppSettings {
  ollamaUrl: string
  chatModel: string
  embeddingModel: string
}

export interface ProcessFileResult {
  success: boolean
  count?: number
  preview?: string
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
      getSettings: () => Promise<AppSettings>
      saveSettings: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>
    }
  }
}
