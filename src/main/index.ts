import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import icon from '../../resources/icon.png?asset'

// 使用环境变量检测开发模式，因为 app.isPackaged 在模块加载时不可用
const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']
import { loadAndSplitFile } from './rag/loader'
import { addDocumentsToStore, initVectorStore } from './rag/store'
import { chatWithRag } from './rag/chat'
import { getSettings, saveSettings, AppSettings } from './settings'
import {
  getKnowledgeBaseSnapshot,
  removeIndexedFileRecord,
  reindexSingleFile,
  upsertIndexedFileRecord,
  createDocumentCollection,
  updateDocumentCollection,
  deleteDocumentCollection,
  refreshKnowledgeBase
} from './rag/knowledgeBase'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }
  if (typeof error === 'object' && error && 'message' in error) {
    return String((error as { message?: unknown }).message)
  }
  if (typeof error === 'string') {
    return error
  }
  return ''
}

function isSchemaMismatchError(error: unknown): boolean {
  return getErrorMessage(error).includes('Found field not in schema')
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  app.setAppUserModelId('com.electron')

  // Initialize LanceDB vector store
  try {
    await initVectorStore()
    console.log('LanceDB initialized successfully')
  } catch (error) {
    console.error('Failed to initialize LanceDB:', error)
  }

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    if (isDev) {
      window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12') {
          window.webContents.toggleDevTools()
          event.preventDefault()
        }
      })
    }
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'txt', 'md'] }]
    })
    if (canceled) return null
    return filePaths[0]
  })

  ipcMain.handle('rag:processFile', async (_, filePath) => {
    try {
      console.log('Processing file:', filePath)
      const docs = await loadAndSplitFile(filePath)
      console.log(`Processed ${docs.length} chunks`)

      const preview = docs[0]?.pageContent.slice(0, 160)
      const record = {
        path: filePath,
        name: basename(filePath),
        chunkCount: docs.length,
        preview,
        updatedAt: Date.now()
      }

      try {
        await addDocumentsToStore(docs)
        upsertIndexedFileRecord(record)
      } catch (error) {
        if (isSchemaMismatchError(error)) {
          console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
          upsertIndexedFileRecord(record)
          await refreshKnowledgeBase()
        } else {
          throw error
        }
      }

      return { success: true, count: docs.length, preview }
    } catch (error) {
      console.error('Error processing file:', error)
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('kb:list', () => {
    return getKnowledgeBaseSnapshot()
  })

  ipcMain.handle('files:list', () => {
    return getKnowledgeBaseSnapshot()
  })

  ipcMain.handle('files:remove', async (_, filePath: string) => {
    return removeIndexedFileRecord(filePath)
  })

  ipcMain.handle('files:reindex', async (_, filePath: string) => {
    return reindexSingleFile(filePath)
  })

  ipcMain.handle(
    'collections:create',
    (_, payload: { name: string; description?: string; files?: string[] }) => {
      return createDocumentCollection(payload)
    }
  )

  ipcMain.handle(
    'collections:update',
    (_, payload: { id: string; name?: string; description?: string; files?: string[] }) => {
      const { id, ...updates } = payload
      return updateDocumentCollection(id, updates)
    }
  )

  ipcMain.handle('collections:delete', (_, collectionId: string) => {
    return deleteDocumentCollection(collectionId)
  })

  ipcMain.on('rag:chat', async (event, payload) => {
    const normalized =
      typeof payload === 'string'
        ? { question: payload, sources: undefined }
        : { question: payload?.question, sources: payload?.sources }

    if (!normalized.question) {
      event.reply('rag:chat-error', '问题内容不能为空')
      return
    }

    try {
      console.log('Chat question:', normalized.question)
      const { stream, sources } = await chatWithRag(normalized.question, {
        sources: normalized.sources
      })

      event.reply('rag:chat-sources', sources)

      for await (const chunk of stream) {
        event.reply('rag:chat-token', chunk)
      }
      event.reply('rag:chat-done')
    } catch (error) {
      console.error('Chat error:', error)
      event.reply('rag:chat-error', String(error))
    }
  })

  // Settings IPC
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:save', (_, settings: Partial<AppSettings>) => {
    saveSettings(settings)
    return { success: true }
  })

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
