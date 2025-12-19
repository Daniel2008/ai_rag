import { contextBridge, ipcRenderer } from 'electron'
import type { KnowledgeBaseSnapshot } from '../types/files'
import type { ChatSource, AppSettings, ProcessFileResult } from '../types/chat'

// 重新导出共享类型，保持向后兼容
export type {
  ChatSource,
  ModelProvider,
  ProviderConfig,
  AppSettings,
  ProcessFileResult
} from '../types/chat'

// 自定义 electronAPI 替代 @electron-toolkit/preload
const electronAPI = {
  ipcRenderer: {
    send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
    on: (
      channel: string,
      listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
    ) => {
      ipcRenderer.on(channel, listener)
      return () => ipcRenderer.removeListener(channel, listener)
    },
    once: (
      channel: string,
      listener: (event: Electron.IpcRendererEvent, ...args: unknown[]) => void
    ) => {
      ipcRenderer.once(channel, listener)
    },
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    removeAllListeners: (channel: string) => ipcRenderer.removeAllListeners(channel)
  },
  process: {
    platform: process.platform,
    versions: process.versions
  }
}

// Custom APIs for renderer
const api = {
  // Window Control APIs
  minimizeWindow: (): void => ipcRenderer.send('window:minimize'),
  maximizeWindow: (): void => ipcRenderer.send('window:maximize'),
  closeWindow: (): void => ipcRenderer.send('window:close'),
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:isMaximized'),
  onMaximizedChange: (callback: (isMaximized: boolean) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, isMaximized: boolean): void => {
      callback(isMaximized)
    }
    ipcRenderer.on('window:maximized-changed', handler)
    return () => ipcRenderer.removeListener('window:maximized-changed', handler)
  },
  // Platform info
  platform: process.platform,

  selectFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFile'),
  processFile: (path: string | string[]): Promise<ProcessFileResult> =>
    ipcRenderer.invoke('rag:processFile', path),
  processUrl: (
    url: string
  ): Promise<{
    success: boolean
    count?: number
    title?: string
    preview?: string
    error?: string
  }> => ipcRenderer.invoke('rag:processUrl', url),
  chat: (payload: {
    conversationKey: string
    question: string
    sources?: string[]
    tags?: string[]
  }): void => ipcRenderer.send('rag:chat', payload),
  getKnowledgeBase: (): Promise<KnowledgeBaseSnapshot> => ipcRenderer.invoke('kb:list'),
  refreshKnowledgeBase: (): Promise<KnowledgeBaseSnapshot> => ipcRenderer.invoke('kb:refresh'),
  rebuildKnowledgeBase: (): Promise<KnowledgeBaseSnapshot> => ipcRenderer.invoke('kb:rebuild'),
  removeIndexedFile: (filePath: string): Promise<KnowledgeBaseSnapshot> =>
    ipcRenderer.invoke('files:remove', filePath),
  reindexIndexedFile: (filePath: string): Promise<KnowledgeBaseSnapshot> =>
    ipcRenderer.invoke('files:reindex', filePath),
  createCollection: (payload: {
    name: string
    description?: string
    files?: string[]
  }): Promise<KnowledgeBaseSnapshot> => ipcRenderer.invoke('collections:create', payload),
  updateCollection: (payload: {
    id: string
    name?: string
    description?: string
    files?: string[]
  }): Promise<KnowledgeBaseSnapshot> => ipcRenderer.invoke('collections:update', payload),
  deleteCollection: (collectionId: string): Promise<KnowledgeBaseSnapshot> =>
    ipcRenderer.invoke('collections:delete', collectionId),
  onChatToken: (callback: (token: string) => void): void => {
    ipcRenderer.removeAllListeners('rag:chat-token')
    ipcRenderer.on('rag:chat-token', (_, token) => callback(token))
  },
  onChatSources: (callback: (sources: ChatSource[]) => void): void => {
    ipcRenderer.removeAllListeners('rag:chat-sources')
    ipcRenderer.on('rag:chat-sources', (_, sources) => callback(sources))
  },
  onChatSuggestions: (callback: (suggestions: string[]) => void): void => {
    ipcRenderer.removeAllListeners('rag:chat-suggestions')
    ipcRenderer.on('rag:chat-suggestions', (_, suggestions) => callback(suggestions))
  },
  onChatDone: (callback: () => void): void => {
    ipcRenderer.removeAllListeners('rag:chat-done')
    ipcRenderer.on('rag:chat-done', () => callback())
  },
  onChatError: (callback: (error: string) => void): void => {
    ipcRenderer.removeAllListeners('rag:chat-error')
    ipcRenderer.on('rag:chat-error', (_, error) => callback(error))
  },
  removeAllChatListeners: (): void => {
    ipcRenderer.removeAllListeners('rag:chat-token')
    ipcRenderer.removeAllListeners('rag:chat-sources')
    ipcRenderer.removeAllListeners('rag:chat-suggestions')
    ipcRenderer.removeAllListeners('rag:chat-done')
    ipcRenderer.removeAllListeners('rag:chat-error')
  },
  // 文档处理进度监听
  onProcessProgress: (
    callback: (progress: {
      stage: string
      percent: number
      error?: string
      taskType?: string
    }) => void
  ): void => {
    ipcRenderer.removeAllListeners('rag:process-progress')
    ipcRenderer.on('rag:process-progress', (_, progress) => callback(progress))
  },
  removeProcessProgressListener: (): void => {
    ipcRenderer.removeAllListeners('rag:process-progress')
  },
  // 嵌入模型进度监听
  onEmbeddingProgress: (
    callback: (progress: {
      status: 'downloading' | 'loading' | 'ready' | 'completed' | 'processing' | 'error'
      progress?: number
      file?: string
      message?: string
    }) => void
  ): void => {
    ipcRenderer.removeAllListeners('embedding:progress')
    ipcRenderer.on('embedding:progress', (_, progress) => callback(progress))
  },
  removeEmbeddingProgressListener: (): void => {
    ipcRenderer.removeAllListeners('embedding:progress')
  },
  // Settings API
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:save', settings),

  // Document Generation API
  generateDocument: (request: {
    type: 'word' | 'ppt'
    title: string
    description?: string
    sources?: string[]
    theme?: 'professional' | 'modern' | 'simple' | 'creative'
  }): Promise<{ success: boolean; filePath?: string; error?: string }> =>
    ipcRenderer.invoke('document:generate', request),
  onDocumentProgress: (
    callback: (progress: {
      stage: 'outline' | 'content' | 'generating' | 'complete' | 'error'
      percent: number
      message: string
      error?: string
    }) => void
  ): void => {
    ipcRenderer.removeAllListeners('document:progress')
    ipcRenderer.on('document:progress', (_, progress) => callback(progress))
  },
  removeDocumentProgressListener: (): void => {
    ipcRenderer.removeAllListeners('document:progress')
  },

  // Database APIs
  getConversations: () => ipcRenderer.invoke('db:getConversations'),
  createConversation: (key: string, label: string) =>
    ipcRenderer.invoke('db:createConversation', key, label),
  deleteConversation: (key: string) => ipcRenderer.invoke('db:deleteConversation', key),
  getMessages: (key: string, limit?: number, offset?: number) =>
    ipcRenderer.invoke('db:getMessages', key, limit, offset),
  saveMessage: (conversationKey: string, message: unknown) =>
    ipcRenderer.invoke('db:saveMessage', conversationKey, message),
  updateMessage: (messageKey: string, updates: unknown) =>
    ipcRenderer.invoke('db:updateMessage', messageKey, updates),
  generateTitle: (conversationKey: string, question: string, answer: string) =>
    ipcRenderer.invoke('rag:generateTitle', conversationKey, question, answer),
  getMetricsRecent: (
    count?: number
  ): Promise<
    Array<{
      message: string
      timestamp: number
      context?: string
      metadata?: Record<string, unknown>
    }>
  > => ipcRenderer.invoke('metrics:getRecent', count),

  // Update Service APIs
  checkForUpdates: (): Promise<{ success: boolean }> => ipcRenderer.invoke('update:check'),
  downloadUpdate: (): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('update:download'),
  installUpdate: (): Promise<{ success: boolean }> => ipcRenderer.invoke('update:install'),
  getUpdateStatus: (): Promise<{
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
  }> => ipcRenderer.invoke('update:getStatus'),
  forceCheckUpdateDev: (): Promise<{ success: boolean; message?: string }> =>
    ipcRenderer.invoke('update:forceCheckDev'),
  onUpdateAvailable: (
    callback: (info: { version: string; releaseNotes?: string; releaseDate?: string }) => void
  ): void => {
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.on('update-available', (_, info) => callback(info))
  },
  onUpdateNotAvailable: (callback: (info: { currentVersion: string }) => void): void => {
    ipcRenderer.removeAllListeners('update-not-available')
    ipcRenderer.on('update-not-available', (_, info) => callback(info))
  },
  onDownloadProgress: (
    callback: (progress: {
      percent: number
      bytesPerSecond: number
      total: number
      transferred: number
    }) => void
  ): void => {
    ipcRenderer.removeAllListeners('download-progress')
    ipcRenderer.on('download-progress', (_, progress) => callback(progress))
  },
  onUpdateDownloaded: (callback: (info: { version: string }) => void): void => {
    ipcRenderer.removeAllListeners('update-downloaded')
    ipcRenderer.on('update-downloaded', (_, info) => callback(info))
  },
  onUpdateError: (callback: (error: { error: string }) => void): void => {
    ipcRenderer.removeAllListeners('update-error')
    ipcRenderer.on('update-error', (_, error) => callback(error))
  },
  removeAllUpdateListeners: (): void => {
    ipcRenderer.removeAllListeners('update-available')
    ipcRenderer.removeAllListeners('update-not-available')
    ipcRenderer.removeAllListeners('download-progress')
    ipcRenderer.removeAllListeners('update-downloaded')
    ipcRenderer.removeAllListeners('update-error')
    ipcRenderer.removeAllListeners('update-status-changed')
  },
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
  ): void => {
    ipcRenderer.removeAllListeners('update-status-changed')
    ipcRenderer.on('update-status-changed', (_, status) => callback(status))
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
