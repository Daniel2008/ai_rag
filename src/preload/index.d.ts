import { ElectronAPI } from '@electron-toolkit/preload'

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

declare global {
  interface Window {
    electron: ElectronAPI
    api: {
      selectFile: () => Promise<string | null>
      processFile: (path: string) => Promise<ProcessFileResult>
      chat: (question: string) => void
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
