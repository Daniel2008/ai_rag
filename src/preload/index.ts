import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

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

// Custom APIs for renderer
const api = {
  selectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  processFile: (path: string): Promise<ProcessFileResult> => ipcRenderer.invoke('rag:processFile', path),
  chat: (question: string): void => ipcRenderer.send('rag:chat', question),
  onChatToken: (callback: (token: string) => void): void => {
    ipcRenderer.on('rag:chat-token', (_, token) => callback(token))
  },
  onChatSources: (callback: (sources: ChatSource[]) => void): void => {
    ipcRenderer.on('rag:chat-sources', (_, sources) => callback(sources))
  },
  onChatDone: (callback: () => void): void => {
    ipcRenderer.on('rag:chat-done', () => callback())
  },
  onChatError: (callback: (error: string) => void): void => {
    ipcRenderer.on('rag:chat-error', (_, error) => callback(error))
  },
  removeAllChatListeners: (): void => {
    ipcRenderer.removeAllListeners('rag:chat-token')
    ipcRenderer.removeAllListeners('rag:chat-sources')
    ipcRenderer.removeAllListeners('rag:chat-done')
    ipcRenderer.removeAllListeners('rag:chat-error')
  },
  // Settings API
  getSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:get'),
  saveSettings: (settings: Partial<AppSettings>): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('settings:save', settings)
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
