import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { normalizeError, isSchemaMismatchError as checkSchemaMismatch } from './utils/errorHandler'
import { join, basename, dirname, delimiter } from 'path'
import Module from 'module'

// 修复打包后原生模块路径解析问题
if (app.isPackaged) {
  // 获取 app.asar.unpacked 路径
  const unpackedPath = join(dirname(app.getAppPath()), 'app.asar.unpacked', 'node_modules')

  // 扩展模块搜索路径
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalResolveLookupPaths = (Module as any)._resolveLookupPaths
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Module as any)._resolveLookupPaths = function (request: string, parent: any) {
    const result = originalResolveLookupPaths.call(this, request, parent)
    if (result && Array.isArray(result)) {
      // 添加 unpacked 路径到搜索路径
      if (!result.includes(unpackedPath)) {
        result.unshift(unpackedPath)
      }
    }
    return result
  }

  // 设置 NODE_PATH 环境变量
  const existingNodePath = process.env.NODE_PATH || ''
  process.env.NODE_PATH = existingNodePath
    ? `${unpackedPath}${delimiter}${existingNodePath}`
    : unpackedPath
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(Module as any)._initPaths()
}
import icon from '../../resources/icon.png?asset'
import type { ChatMessage } from '../types/chat'
import {
  getAllConversations,
  createConversation,
  deleteConversation,
  getMessages,
  saveMessage,
  updateMessage,
  updateConversationTimestamp
} from './db/service'
import { loadAndSplitFileInWorker } from './rag/workerManager'
import { loadFromUrl } from './rag/urlLoader'
import {
  addDocumentsToStore,
  initVectorStore,
  clearEmbeddingsCache,
  removeSourceFromStore
} from './rag/store'
import { chatWithRag } from './rag/chat'
import { getSettings, saveSettings, AppSettings } from './settings'
import {
  getKnowledgeBaseSnapshot,
  removeIndexedFileRecord,
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

// 使用统一的错误处理工具
function getErrorMessage(error: unknown): string {
  return normalizeError(error).message
}

function isSchemaMismatchError(error: unknown): boolean {
  return checkSchemaMismatch(error)
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

  ipcMain.handle('db:saveMessage', (_, conversationKey: string, message: ChatMessage) =>
    saveMessage(conversationKey, message)
  )

  ipcMain.handle('db:updateMessage', (_, messageKey: string, updates: Partial<ChatMessage>) =>
    updateMessage(messageKey, updates)
  )

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('dialog:openFile', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'Documents', extensions: ['pdf', 'docx', 'doc', 'txt', 'md'] }]
    })
    if (canceled) return []
    return filePaths
  })

  ipcMain.handle('rag:processFile', async (event, filePaths: string | string[]) => {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
    const results: { success: boolean; count?: number; preview?: string; error?: string }[] = []

    // 总进度计算
    let processedCount = 0
    const totalFiles = paths.length

    for (const filePath of paths) {
      console.log('Processing file:', filePath)
      const basePercent = Math.round((processedCount / totalFiles) * 100)

      try {
        // 发送进度：开始解析文档
        event.sender.send('rag:process-progress', {
          stage: `正在解析文档 (${processedCount + 1}/${totalFiles})...`,
          percent: basePercent + 5,
          taskType: 'DOCUMENT_PARSE'
        })

        // 1. 先清理旧索引（如果存在），避免重复
        try {
          await removeSourceFromStore(filePath)
        } catch (e) {
          console.warn('Failed to clean up old index for', filePath, e)
        }

        const docs = await loadAndSplitFileInWorker(filePath)
        console.log(`Processed ${docs.length} chunks`)

        // 发送进度：文档解析完成
        event.sender.send('rag:process-progress', {
          stage: `文档解析完成，共 ${docs.length} 个片段`,
          percent: basePercent + 10,
          taskType: 'DOCUMENT_PARSE'
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
          const { toFrontendProgressFormat } = await import('./utils/progressHelper')
          await addDocumentsToStore(docs, (progress) => {
            // 计算当前文件内的进度
            const fileProgress = (progress.progress || 0) / 100 * (100 / totalFiles) * 0.8 // 80% 权重给索引过程
            const currentPercent = basePercent + 10 + Math.round(fileProgress)
            const frontendFormat = toFrontendProgressFormat({
              ...progress,
              message: `${progress.message} (${processedCount + 1}/${totalFiles})`
            })
            event.sender.send('rag:process-progress', {
              ...frontendFormat,
              percent: Math.min(currentPercent, 99)
            })
          })
          upsertIndexedFileRecord(record)
          results.push({ success: true, count: docs.length, preview })
        } catch (error) {
          if (isSchemaMismatchError(error)) {
            console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
            event.sender.send('rag:process-progress', {
              stage: '正在重建索引...',
              percent: 80,
              taskType: 'INDEX_REBUILD'
            })
            upsertIndexedFileRecord(record)
            await refreshKnowledgeBase((progress) => {
              event.sender.send('rag:process-progress', {
                stage: progress.message,
                percent: progress.progress || 0,
                taskType: progress.taskType
              })
            })
            results.push({ success: true, count: docs.length, preview })
          } else {
            throw error
          }
        }
      } catch (error) {
        console.error('Error processing file:', filePath, error)
        // 发送错误进度，但不中断其他文件
        event.sender.send('rag:process-progress', {
          stage: `处理失败: ${basename(filePath)}`,
          percent: basePercent,
          error: String(error),
          taskType: 'ERROR'
        })
        results.push({ success: false, error: String(error) })
      }

      processedCount++
    }

    // 发送进度：完成
    event.sender.send('rag:process-progress', {
      stage: '所有文档索引完成',
      percent: 100,
      taskType: 'COMPLETED'
    })

    // 如果只有一个文件，返回单个结果（保持兼容），否则返回最后一个成功的结果或合并结果？
    // 前端目前只消费单个结果。为了兼容，我们返回最后一个结果，或者修改前端。
    // 鉴于前端改动较大，我们这里返回最后一个结果，但其实前端主要看 processProgress。
    // 更好的方式是返回汇总结果。
    const successCount = results.filter((r) => r.success).length
    return {
      success: successCount > 0,
      count: results.reduce((acc, r) => acc + (r.count || 0), 0),
      preview: results.find((r) => r.preview)?.preview,
      error: successCount === 0 ? results[0]?.error : undefined
    }
  })

  // 从 URL 加载内容到知识库
  ipcMain.handle('rag:processUrl', async (event, url: string) => {
    try {
      console.log('Processing URL:', url)

      // 发送进度：开始抓取
      event.sender.send('rag:process-progress', {
        stage: '正在获取网页内容...',
        percent: 10,
        taskType: 'DOCUMENT_PARSE'
      })

      const result = await loadFromUrl(url, {
        onProgress: (stage, percent) => {
          event.sender.send('rag:process-progress', {
            stage,
            percent,
            taskType: 'DOCUMENT_PARSE'
          })
        }
      })

      if (!result.success || !result.documents) {
        throw new Error(result.error || '无法获取网页内容')
      }

      console.log(`Fetched ${result.documents.length} chunks from URL`)

      // 发送进度：内容获取完成
      event.sender.send('rag:process-progress', {
        stage: `内容获取完成，共 ${result.documents.length} 个片段`,
        percent: 30,
        taskType: 'DOCUMENT_PARSE'
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
        await addDocumentsToStore(result.documents, (progress) => {
          event.sender.send('rag:process-progress', {
            stage: progress.message,
            percent: progress.progress || 0,
            taskType: progress.taskType
          })
        })
        upsertIndexedFileRecord(record)
      } catch (error) {
        if (isSchemaMismatchError(error)) {
          console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
          event.sender.send('rag:process-progress', {
            taskType: 'INDEX_REBUILD',
            stage: '正在重建索引...',
            percent: 80
          })
          upsertIndexedFileRecord(record)
          await refreshKnowledgeBase((progress) => {
            event.sender.send('rag:process-progress', {
              stage: progress.message,
              percent: progress.progress || 0,
              taskType: progress.taskType
            })
          })
        } else {
          throw error
        }
      }

      // 发送进度：完成
      event.sender.send('rag:process-progress', {
        stage: '索引完成',
        percent: 100,
        taskType: 'COMPLETED'
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
        error: String(error),
        taskType: 'ERROR'
      })
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('kb:list', () => {
    return getKnowledgeBaseSnapshot()
  })

  // 重建全部索引
  ipcMain.handle('kb:rebuild', async (event) => {
    try {
      event.sender.send('rag:process-progress', {
        stage: '正在重建知识库索引...',
        percent: 5,
        taskType: 'INDEX_REBUILD'
      })

      const snapshot = await refreshKnowledgeBase((progress) => {
        // 转换 ProgressMessage 到前端期望的格式
        event.sender.send('rag:process-progress', {
          stage: progress.message,
          percent: progress.progress || 0,
          error: progress.status === 'error' ? progress.message : undefined,
          taskType: progress.taskType
        })
      })

      event.sender.send('rag:process-progress', {
        stage: '重建完成',
        percent: 100,
        taskType: 'INDEX_REBUILD'
      })

      return snapshot
    } catch (error) {
      console.error('Failed to rebuild knowledge base:', error)
      event.sender.send('rag:process-progress', {
        stage: '重建失败',
        percent: 0,
        error: getErrorMessage(error)
      })
      throw error
    }
  })

  ipcMain.handle('files:list', () => {
    return getKnowledgeBaseSnapshot()
  })

  ipcMain.handle('files:remove', async (_, filePath: string) => {
    return removeIndexedFileRecord(filePath)
  })

  ipcMain.handle('files:reindex', async (event, filePath: string) => {
    try {
      event.sender.send('rag:process-progress', {
        stage: '正在清理旧索引...',
        percent: 10,
        taskType: 'INDEX_REBUILD'
      })

      await removeSourceFromStore(filePath)

      if (filePath.startsWith('http://') || filePath.startsWith('https://')) {
        event.sender.send('rag:process-progress', {
          stage: '正在获取页面内容...',
          percent: 20,
          taskType: 'DOCUMENT_PARSE'
        })

        const result = await loadFromUrl(filePath)
        if (!(result.success && result.documents)) {
          throw new Error(result.error || '内容获取失败')
        }

        event.sender.send('rag:process-progress', {
          stage: `内容获取完成，共 ${result.documents.length} 个片段`,
          percent: 30,
          taskType: 'DOCUMENT_PARSE'
        })

        const preview = result.content?.slice(0, 160) || ''
        const record = {
          path: filePath,
          name: result.title || filePath,
          chunkCount: result.documents.length,
          preview,
          updatedAt: Date.now(),
          sourceType: 'url' as const,
          url: filePath,
          siteName: result.meta?.siteName
        }

        try {
          await addDocumentsToStore(result.documents, (progress) => {
            event.sender.send('rag:process-progress', progress)
          })
          upsertIndexedFileRecord(record)
        } catch (error) {
          if (isSchemaMismatchError(error)) {
            event.sender.send('rag:process-progress', {
              taskType: 'index_rebuild',
              status: 'processing',
              progress: 80,
              message: '正在重建索引...'
            })
            upsertIndexedFileRecord(record)
            await refreshKnowledgeBase((progress) => {
              event.sender.send('rag:process-progress', progress)
            })
          } else {
            throw error
          }
        }

        event.sender.send('rag:process-progress', {
          stage: '索引完成',
          percent: 100,
          taskType: 'COMPLETED'
        })

        return getKnowledgeBaseSnapshot()
      }

      event.sender.send('rag:process-progress', {
        stage: '正在解析文档...',
        percent: 20,
        taskType: 'DOCUMENT_PARSE'
      })

      const docs = await loadAndSplitFileInWorker(filePath)

      event.sender.send('rag:process-progress', {
        stage: `文档解析完成，共 ${docs.length} 个片段`,
        percent: 30,
        taskType: 'DOCUMENT_PARSE'
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
        await addDocumentsToStore(docs, (progress) => {
          event.sender.send('rag:process-progress', progress)
        })
        upsertIndexedFileRecord(record)
      } catch (error) {
        if (isSchemaMismatchError(error)) {
          event.sender.send('rag:process-progress', {
            taskType: 'index_rebuild',
            status: 'processing',
            progress: 80,
            message: '正在重建索引...'
          })
          upsertIndexedFileRecord(record)
          await refreshKnowledgeBase((progress) => {
            event.sender.send('rag:process-progress', progress)
          })
        } else {
          throw error
        }
      }

      event.sender.send('rag:process-progress', {
        stage: '索引完成',
        percent: 100,
        taskType: 'COMPLETED'
      })

      return getKnowledgeBaseSnapshot()
    } catch (error) {
      event.sender.send('rag:process-progress', {
        stage: '处理失败',
        percent: 0,
        error: String(error),
        taskType: 'ERROR'
      })
      throw error
    }
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

  ipcMain.handle('collections:delete', async (_, collectionId: string) => {
    return await deleteDocumentCollection(collectionId)
  })

  ipcMain.on('rag:chat', async (event, payload) => {
    const normalized =
      typeof payload === 'string'
        ? { question: payload, sources: undefined }
        : { question: payload?.question, sources: payload?.sources }

    // 输入验证
    if (!normalized.question) {
      event.reply('rag:chat-error', '问题内容不能为空')
      return
    }
    
    const { RAG_CONFIG } = await import('./utils/config')
    if (normalized.question.length > RAG_CONFIG.VALIDATION.MAX_QUERY_LENGTH) {
      event.reply('rag:chat-error', `问题内容过长，最多支持 ${RAG_CONFIG.VALIDATION.MAX_QUERY_LENGTH} 个字符`)
      return
    }
    
    if (normalized.question.length < RAG_CONFIG.VALIDATION.MIN_QUERY_LENGTH) {
      event.reply('rag:chat-error', '问题内容不能为空')
      return
    }
    
    if (normalized.sources && normalized.sources.length > RAG_CONFIG.VALIDATION.MAX_SOURCES) {
      event.reply('rag:chat-error', `指定来源过多，最多支持 ${RAG_CONFIG.VALIDATION.MAX_SOURCES} 个文件`)
      return
    }

    try {
      console.log('Chat question:', normalized.question)

      // 检查是否是文档生成意图
      const docGenerator = handleDocumentGenerationIfNeeded(normalized.question, normalized.sources)

      if (docGenerator) {
        // 使用文档生成流程
        console.log('Detected document generation intent')
        event.reply('rag:chat-sources', []) // 文档生成自己管理来源

        try {
          for await (const chunk of docGenerator) {
            event.reply('rag:chat-token', chunk)
          }
          event.reply('rag:chat-done')
        } catch (docError) {
          const errorInfo = normalizeError(docError)
          console.error('Document generation error:', errorInfo.message, errorInfo.details)
          event.reply('rag:chat-error', errorInfo.userFriendly || '文档生成失败')
        }
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
      const errorInfo = normalizeError(error)
      console.error('Chat error:', errorInfo.message, errorInfo.details)
      event.reply('rag:chat-error', errorInfo.userFriendly || errorInfo.message)
    }
  })

  ipcMain.handle('rag:generateTitle', async (_, conversationKey: string, question: string) => {
    // 直接使用用户第一个问题作为会话标题（截取前20个字符）
    const title = question.trim().slice(0, 20) + (question.length > 20 ? '...' : '')
    updateConversationTimestamp(conversationKey, title)
    return title
  })

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

  ipcMain.handle('settings:save', async (event, settings: Partial<AppSettings>) => {
    const oldSettings = getSettings()
    saveSettings(settings)

    // 如果嵌入模型设置变化，清除缓存并通知用户
    if (settings.embeddingProvider !== undefined || settings.embeddingModel !== undefined) {
      const newSettings = getSettings()
      const embeddingChanged =
        oldSettings.embeddingProvider !== newSettings.embeddingProvider ||
        oldSettings.embeddingModel !== newSettings.embeddingModel

      if (embeddingChanged) {
        await clearEmbeddingsCache()
        console.log('Embedding settings changed, cache cleared')

        // 自动触发重建索引
        refreshKnowledgeBase((progress) => {
          event.sender.send('rag:process-progress', {
            stage: progress.message,
            percent: progress.progress || 0,
            taskType: progress.taskType
          })
        }).catch((error) => {
          console.error('Auto reindex failed:', error)
          event.sender.send('rag:process-progress', {
            stage: '索引重建失败',
            percent: 0,
            error: error instanceof Error ? error.message : String(error)
          })
        })

        return { success: true, embeddingChanged: true, reindexingStarted: true }
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

// 清理资源：在应用退出前终止所有 Worker
app.on('before-quit', async (event) => {
  event.preventDefault()
  
  try {
    // 清理所有 Worker
    const { terminateDocumentWorker } = await import('./rag/workerManager')
    const { closeVectorStore } = await import('./rag/store')
    
    await Promise.all([
      terminateDocumentWorker(),
      closeVectorStore()
    ])
    
    console.log('All workers and resources cleaned up')
  } catch (error) {
    console.error('Error during cleanup:', error)
  } finally {
    app.exit(0)
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
