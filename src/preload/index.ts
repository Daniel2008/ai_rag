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

  selectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  processFile: (path: string): Promise<ProcessFileResult> =>
    ipcRenderer.invoke('rag:processFile', path),
  chat: (payload: { question: string; sources?: string[] }): void =>
    ipcRenderer.send('rag:chat', payload),
  getKnowledgeBase: (): Promise<KnowledgeBaseSnapshot> => ipcRenderer.invoke('kb:list'),
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
    ipcRenderer.removeAllListeners('rag:chat-done')
    ipcRenderer.removeAllListeners('rag:chat-error')
  },
  // 文档处理进度监听
  onProcessProgress: (
    callback: (progress: { stage: string; percent: number; error?: string }) => void
  ): void => {
    ipcRenderer.removeAllListeners('rag:process-progress')
    ipcRenderer.on('rag:process-progress', (_, progress) => callback(progress))
  },
  removeProcessProgressListener: (): void => {
    ipcRenderer.removeAllListeners('rag:process-progress')
  },
  // Settings API
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:save', settings),

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
    ipcRenderer.invoke('rag:generateTitle', conversationKey, question, answer)
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
