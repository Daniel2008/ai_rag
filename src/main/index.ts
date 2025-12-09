import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { join, basename } from 'path'
import icon from '../../resources/icon.png?asset'
import {
  getAllConversations,
  createConversation,
  deleteConversation,
  getMessages,
  saveMessage,
  updateMessage,
  updateConversationTimestamp
} from './db/service'
import { loadAndSplitFile } from './rag/loader'
import { loadFromUrl } from './rag/urlLoader'
import { addDocumentsToStore, initVectorStore, clearEmbeddingsCache } from './rag/store'
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
import {
  generateDocument,
  setLLMChatFunction,
  handleDocumentGenerationIfNeeded,
  type DocumentGenerateRequest
} from './document'

// 使用环境变量检测开发模式，因为 app.isPackaged 在模块加载时不可用
const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']

// 主窗口引用（模块级变量）
let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  // Create the browser window.
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false, // 无边框窗口，完全自定义标题栏
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
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

  // Window Control IPC
  ipcMain.on('window:minimize', () => {
    mainWindow?.minimize()
  })

  ipcMain.on('window:maximize', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow.unmaximize()
    } else {
      mainWindow?.maximize()
    }
  })

  ipcMain.on('window:close', () => {
    mainWindow?.close()
  })

  ipcMain.handle('window:isMaximized', () => {
    return mainWindow?.isMaximized() ?? false
  })

  // Database IPC
  ipcMain.handle('db:getConversations', () => getAllConversations())

  ipcMain.handle('db:createConversation', (_, key: string, label: string) =>
    createConversation(key, label)
  )

  ipcMain.handle('db:deleteConversation', (_, key: string) => deleteConversation(key))

  ipcMain.handle('db:getMessages', (_, key: string, limit?: number, offset?: number) =>
    getMessages(key, limit, offset)
  )

  ipcMain.handle('db:saveMessage', (_, conversationKey: string, message: any) =>
    saveMessage(conversationKey, message)
  )

  ipcMain.handle('db:updateMessage', (_, messageKey: string, updates: any) =>
    updateMessage(messageKey, updates)
  )

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt', 'md'] }]
    })
    if (canceled) return null
    return filePaths[0]
  })

  ipcMain.handle('rag:processFile', async (event, filePath) => {
    try {
      console.log('Processing file:', filePath)

      // 发送进度：开始解析文档
      event.sender.send('rag:process-progress', {
        stage: '正在解析文档...',
        percent: 10
      })

      const docs = await loadAndSplitFile(filePath)
      console.log(`Processed ${docs.length} chunks`)

      // 发送进度：文档解析完成
      event.sender.send('rag:process-progress', {
        stage: `文档解析完成，共 ${docs.length} 个片段`,
        percent: 30
      })

      const preview = docs[0]?.pageContent.slice(0, 160)
      const record = {
        path: filePath,
        name: basename(filePath),
        chunkCount: docs.length,
        preview,
        updatedAt: Date.now()
      }

      try {
        // 添加进度回调
        await addDocumentsToStore(docs, (current, total, stage) => {
          const percent = 30 + Math.round((current / total) * 60)
          event.sender.send('rag:process-progress', { stage, percent })
        })
        upsertIndexedFileRecord(record)
      } catch (error) {
        if (isSchemaMismatchError(error)) {
          console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
          event.sender.send('rag:process-progress', {
            stage: '正在重建索引...',
            percent: 80
          })
          upsertIndexedFileRecord(record)
          await refreshKnowledgeBase()
        } else {
          throw error
        }
      }

      // 发送进度：完成
      event.sender.send('rag:process-progress', {
        stage: '索引完成',
        percent: 100
      })

      return { success: true, count: docs.length, preview }
    } catch (error) {
      console.error('Error processing file:', error)
      // 发送错误进度
      event.sender.send('rag:process-progress', {
        stage: '处理失败',
        percent: 0,
        error: String(error)
      })
      return { success: false, error: String(error) }
    }
  })

  // 从 URL 加载内容到知识库
  ipcMain.handle('rag:processUrl', async (event, url: string) => {
    try {
      console.log('Processing URL:', url)

      // 发送进度：开始抓取
      event.sender.send('rag:process-progress', {
        stage: '正在获取网页内容...',
        percent: 10
      })

      const result = await loadFromUrl(url)

      if (!result.success || !result.documents) {
        throw new Error(result.error || '无法获取网页内容')
      }

      console.log(`Fetched ${result.documents.length} chunks from URL`)

      // 发送进度：内容获取完成
      event.sender.send('rag:process-progress', {
        stage: `内容获取完成，共 ${result.documents.length} 个片段`,
        percent: 30
      })

      const preview = result.content?.slice(0, 160) || ''
      const record = {
        path: url,
        name: result.title || url,
        chunkCount: result.documents.length,
        preview,
        updatedAt: Date.now(),
        sourceType: 'url' as const,
        url: url,
        siteName: result.meta?.siteName
      }

      try {
        // 添加进度回调
        await addDocumentsToStore(result.documents, (current, total, stage) => {
          const percent = 30 + Math.round((current / total) * 60)
          event.sender.send('rag:process-progress', { stage, percent })
        })
        upsertIndexedFileRecord(record)
      } catch (error) {
        if (isSchemaMismatchError(error)) {
          console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
          event.sender.send('rag:process-progress', {
            stage: '正在重建索引...',
            percent: 80
          })
          upsertIndexedFileRecord(record)
          await refreshKnowledgeBase()
        } else {
          throw error
        }
      }

      // 发送进度：完成
      event.sender.send('rag:process-progress', {
        stage: '索引完成',
        percent: 100
      })

      return {
        success: true,
        count: result.documents.length,
        title: result.title,
        preview
      }
    } catch (error) {
      console.error('Error processing URL:', error)
      event.sender.send('rag:process-progress', {
        stage: '处理失败',
        percent: 0,
        error: String(error)
      })
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

      // 检查是否是文档生成意图
      const docGenerator = handleDocumentGenerationIfNeeded(
        normalized.question,
        normalized.sources
      )

      if (docGenerator) {
        // 使用文档生成流程
        console.log('Detected document generation intent')
        event.reply('rag:chat-sources', []) // 文档生成自己管理来源

        for await (const chunk of docGenerator) {
          event.reply('rag:chat-token', chunk)
        }
        event.reply('rag:chat-done')
        return
      }

      // 普通 RAG 聊天流程
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

  ipcMain.handle(
    'rag:generateTitle',
    async (_, conversationKey: string, question: string, _answer: string) => {
      // 直接使用用户第一个问题作为会话标题（截取前20个字符）
      const title = question.trim().slice(0, 20) + (question.length > 20 ? '...' : '')
      updateConversationTimestamp(conversationKey, title)
      return title
    }
  )

  // Document Generation IPC
  ipcMain.handle('document:generate', async (_, request: DocumentGenerateRequest) => {
    return generateDocument(request)
  })

  // 设置 LLM 聊天函数供文档生成使用
  setLLMChatFunction(async (question: string, sources?: string[]) => {
    const result = await chatWithRag(question, { sources })
    let content = ''
    for await (const chunk of result.stream) {
      content += chunk
    }
    return { content, sources: result.sources }
  })

  // Settings IPC
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:save', async (_, settings: Partial<AppSettings>) => {
    const oldSettings = getSettings()
    saveSettings(settings)
    
    // 如果嵌入模型设置变化，清除缓存并通知用户
    if (
      settings.embeddingProvider !== undefined ||
      settings.embeddingModel !== undefined
    ) {
      const newSettings = getSettings()
      const embeddingChanged =
        oldSettings.embeddingProvider !== newSettings.embeddingProvider ||
        oldSettings.embeddingModel !== newSettings.embeddingModel
      
      if (embeddingChanged) {
        await clearEmbeddingsCache()
        console.log('Embedding settings changed, cache cleared')
        
        // 返回嵌入模型变更标记，让前端显示提示
        return { success: true, embeddingChanged: true }
      }
    }
    
    return { success: true }
  })

  mainWindow = createWindow()

  // 监听窗口最大化状态变化
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
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
