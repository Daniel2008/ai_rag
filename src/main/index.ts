import { app, shell, BrowserWindow, ipcMain, dialog } from 'electron'
import { normalizeError, isSchemaMismatchError as checkSchemaMismatch } from './utils/errorHandler'
import { join, basename, dirname, delimiter } from 'path'
import Module from 'module'

// 修复打包后滚轮失效问题（某些 GPU 驱动/配置下的兼容性问题）
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,WindowCaptureMacV2')
// 确保输入事件正常工作
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')
// 禁用 GPU 沙盒以避免某些驱动兼容性问题
app.commandLine.appendSwitch('disable-gpu-sandbox')
// 使用软件渲染作为备选（如果 GPU 问题持续）
// app.commandLine.appendSwitch('disable-gpu')

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
} from './rag/store/index'
import { chatWithRag } from './rag/chat'
import { logger } from './utils/logger'
import { runLangGraphChat } from './rag/langgraphChat'
import { getSettings, saveSettings, AppSettings } from './settings'
import {
  initializeAutoUpdater,
  checkForUpdates,
  downloadUpdate,
  installUpdateAndQuit,
  setUpdateWindow,
  getUpdateStatus,
  forceCheckUpdate
} from './utils/updateService'
import {
  getKnowledgeBaseSnapshot,
  removeIndexedFileRecord,
  upsertIndexedFileRecord,
  createDocumentCollection,
  updateDocumentCollection,
  deleteDocumentCollection,
  refreshKnowledgeBase
} from './rag/knowledgeBase'
import { generateDocument, setLLMChatFunction, type DocumentGenerateRequest } from './document'

import { SmartPromptGenerator } from './rag/smartFeatures'

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
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // 确保滚轮和输入事件正常工作
      scrollBounce: true
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

  // Initialize auto update service
  initializeAutoUpdater()

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
      filters: [
        {
          name: 'Documents',
          extensions: ['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'txt', 'md']
        }
      ]
    })
    if (canceled) return []
    return filePaths
  })

  ipcMain.handle('rag:processFile', async (event, filePaths: string | string[]) => {
    const paths = Array.isArray(filePaths) ? filePaths : [filePaths]
    const results: { success: boolean; count?: number; preview?: string; error?: string }[] = []
    const {
      toFrontendProgressFormat,
      createBatchProgress,
      createDocumentParseProgress,
      createDocumentParseComplete
    } = await import('./utils/progressHelper')

    // 总进度计算
    let processedCount = 0
    const totalFiles = paths.length
    const isBatch = totalFiles > 1

    for (const filePath of paths) {
      console.log('Processing file:', filePath)
      const fileName = basename(filePath)

      // 计算基础进度（每个文件占据 100/totalFiles 的进度空间）
      const fileProgressRange = 100 / totalFiles
      const basePercent = Math.round(processedCount * fileProgressRange)

      try {
        // 发送进度：开始解析文档
        if (isBatch) {
          const batchProgress = createBatchProgress(
            (await import('./rag/progressTypes')).TaskType.DOCUMENT_PARSE,
            processedCount + 1,
            totalFiles,
            fileName,
            5
          )
          event.sender.send('rag:process-progress', toFrontendProgressFormat(batchProgress))
        } else {
          const parseProgress = createDocumentParseProgress(5, fileName)
          event.sender.send('rag:process-progress', toFrontendProgressFormat(parseProgress))
        }

        // 1. 先清理旧索引（如果存在），避免重复
        try {
          await removeSourceFromStore(filePath)
        } catch (e) {
          console.warn('Failed to clean up old index for', filePath, e)
        }

        const docs = await loadAndSplitFileInWorker(filePath)
        console.log(`Processed ${docs.length} chunks`)

        // 发送进度：文档解析完成
        const parseCompleteProgress = createDocumentParseComplete(docs.length, fileName)
        if (isBatch) {
          event.sender.send('rag:process-progress', {
            ...toFrontendProgressFormat(parseCompleteProgress),
            stage: `${fileName} 解析完成 (${processedCount + 1}/${totalFiles})`,
            percent: basePercent + Math.round(fileProgressRange * 0.15) // 15% 用于解析
          })
        } else {
          event.sender.send('rag:process-progress', toFrontendProgressFormat(parseCompleteProgress))
        }

        const preview = docs[0]?.pageContent.slice(0, 160)

        // 生成摘要和要点
        let summary: string | undefined
        let keyPoints: string[] | undefined
        try {
          const generator = new SmartPromptGenerator()
          const content = docs
            .slice(0, 10)
            .map((d) => d.pageContent)
            .join('\n\n')
          if (content.length > 100) {
            const result = await generator.generateSummary(content, { length: 'short' })
            summary = result.summary
            keyPoints = result.keyPoints
          }
        } catch (e) {
          console.warn('Failed to generate smart features for', fileName, e)
        }

        const record = {
          path: filePath,
          name: fileName,
          chunkCount: docs.length,
          preview,
          summary,
          keyPoints,
          updatedAt: Date.now()
        }

        try {
          // 添加进度回调，传递向量化进度
          await addDocumentsToStore(docs, (progress) => {
            // 计算当前文件内的进度（向量化占据剩余 80% 的进度）
            const vectorProgress = (progress.progress || 0) / 100
            const currentPercent =
              basePercent + Math.round(fileProgressRange * (0.15 + vectorProgress * 0.8))

            let stageMessage = progress.message
            if (isBatch) {
              stageMessage = `(${processedCount + 1}/${totalFiles}) ${progress.message}`
            }

            event.sender.send('rag:process-progress', {
              stage: stageMessage,
              percent: Math.min(currentPercent, 99),
              taskType: progress.taskType
            })
          })
          upsertIndexedFileRecord(record)
          results.push({ success: true, count: docs.length, preview })
        } catch (error) {
          if (isSchemaMismatchError(error)) {
            console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
            event.sender.send('rag:process-progress', {
              stage: '检测到索引变更，正在重建...',
              percent: 80,
              taskType: 'index_rebuild'
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
        // 发送错误进度，包含文件名
        event.sender.send('rag:process-progress', {
          stage: `处理失败: ${fileName}`,
          percent: basePercent,
          error: String(error),
          taskType: 'error'
        })
        results.push({ success: false, error: String(error) })
      }

      processedCount++
    }

    // 发送进度：完成
    const completeMessage =
      totalFiles === 1 ? '文档已添加到知识库' : `${totalFiles} 个文档已添加到知识库`
    event.sender.send('rag:process-progress', {
      stage: completeMessage,
      percent: 100,
      taskType: 'completed'
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

      // 提取域名作为简短标识
      let urlLabel = url
      try {
        const urlObj = new URL(url)
        urlLabel = urlObj.hostname.replace('www.', '')
      } catch {
        // 保持原 URL
      }

      // 发送进度：开始抓取
      event.sender.send('rag:process-progress', {
        stage: `正在抓取: ${urlLabel}`,
        percent: 5,
        taskType: 'document_parse'
      })

      const result = await loadFromUrl(url, {
        onProgress: (stage, percent) => {
          event.sender.send('rag:process-progress', {
            stage,
            percent,
            taskType: 'document_parse'
          })
        }
      })

      if (!result.success || !result.documents) {
        throw new Error(result.error || '无法获取网页内容')
      }

      console.log(`Fetched ${result.documents.length} chunks from URL`)

      // 发送进度：内容获取完成
      const title = result.title || urlLabel
      event.sender.send('rag:process-progress', {
        stage: `"${title}" 抓取完成`,
        percent: 25,
        taskType: 'document_parse'
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
        // 添加进度回调，优化进度显示
        await addDocumentsToStore(result.documents, (progress) => {
          // 向量化进度从 25% 到 95%
          const vectorPercent = 25 + Math.round((progress.progress || 0) * 0.7)
          event.sender.send('rag:process-progress', {
            stage: progress.message,
            percent: vectorPercent,
            taskType: progress.taskType
          })
        })
        upsertIndexedFileRecord(record)
      } catch (error) {
        if (isSchemaMismatchError(error)) {
          console.warn('Detected LanceDB schema mismatch, rebuilding knowledge base...')
          event.sender.send('rag:process-progress', {
            stage: '检测到索引变更，正在重建...',
            percent: 80,
            taskType: 'index_rebuild'
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
        stage: `"${title}" 已添加到知识库`,
        percent: 100,
        taskType: 'completed'
      })

      return {
        success: true,
        count: result.documents.length,
        title: result.title,
        preview
      }
    } catch (error) {
      console.error('Error processing URL:', error)
      // 优化错误消息
      let errorMessage = String(error)
      if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('getaddrinfo')) {
        errorMessage = '无法访问该网址，请检查网络连接'
      } else if (errorMessage.includes('403') || errorMessage.includes('Forbidden')) {
        errorMessage = '网站拒绝访问'
      } else if (errorMessage.includes('404')) {
        errorMessage = '页面不存在'
      }

      event.sender.send('rag:process-progress', {
        stage: errorMessage,
        percent: 0,
        error: errorMessage,
        taskType: 'error'
      })
      return { success: false, error: errorMessage }
    }
  })

  ipcMain.handle('kb:list', () => {
    return getKnowledgeBaseSnapshot()
  })

  // 重建全部索引（全量）
  ipcMain.handle('kb:rebuild', async (event) => {
    try {
      event.sender.send('rag:process-progress', {
        stage: '准备重建知识库索引...',
        percent: 2,
        taskType: 'index_rebuild'
      })

      const snapshot = await refreshKnowledgeBase((progress) => {
        // 转换 ProgressMessage 到前端期望的格式
        event.sender.send('rag:process-progress', {
          stage: progress.message,
          percent: progress.progress || 0,
          error: progress.status === 'error' ? progress.message : undefined,
          taskType: progress.taskType
        })
      }, false) // 显式传 false 表示全量重建

      event.sender.send('rag:process-progress', {
        stage: '知识库索引重建完成',
        percent: 100,
        taskType: 'completed'
      })

      return snapshot
    } catch (error) {
      console.error('Failed to rebuild knowledge base:', error)
      event.sender.send('rag:process-progress', {
        stage: '知识库重建失败',
        percent: 0,
        error: getErrorMessage(error),
        taskType: 'error'
      })
      throw error
    }
  })

  // 增量更新知识库
  ipcMain.handle('kb:refresh', async (event) => {
    try {
      event.sender.send('rag:process-progress', {
        stage: '正在扫描文件变更...',
        percent: 2,
        taskType: 'index_rebuild'
      })

      const snapshot = await refreshKnowledgeBase((progress) => {
        event.sender.send('rag:process-progress', {
          stage: progress.message,
          percent: progress.progress || 0,
          error: progress.status === 'error' ? progress.message : undefined,
          taskType: progress.taskType
        })
      }, true) // 显式传 true 表示增量更新

      event.sender.send('rag:process-progress', {
        stage: '知识库更新完成',
        percent: 100,
        taskType: 'completed'
      })

      return snapshot
    } catch (error) {
      console.error('Failed to refresh knowledge base:', error)
      event.sender.send('rag:process-progress', {
        stage: '知识库更新失败',
        percent: 0,
        error: getErrorMessage(error),
        taskType: 'error'
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
    const isUrl = filePath.startsWith('http://') || filePath.startsWith('https://')
    const displayName = isUrl
      ? (() => {
          try {
            return new URL(filePath).hostname
          } catch {
            return filePath
          }
        })()
      : basename(filePath)

    try {
      event.sender.send('rag:process-progress', {
        stage: `准备重新索引: ${displayName}`,
        percent: 5,
        taskType: 'index_rebuild'
      })

      await removeSourceFromStore(filePath)

      if (isUrl) {
        event.sender.send('rag:process-progress', {
          stage: `正在重新抓取: ${displayName}`,
          percent: 15,
          taskType: 'document_parse'
        })

        const result = await loadFromUrl(filePath)
        if (!(result.success && result.documents)) {
          throw new Error(result.error || '内容获取失败')
        }

        event.sender.send('rag:process-progress', {
          stage: `抓取完成，共 ${result.documents.length} 个片段`,
          percent: 25,
          taskType: 'document_parse'
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
            const percent = 25 + Math.round((progress.progress || 0) * 0.7)
            event.sender.send('rag:process-progress', {
              stage: progress.message,
              percent,
              taskType: progress.taskType
            })
          })
          upsertIndexedFileRecord(record)
        } catch (error) {
          if (isSchemaMismatchError(error)) {
            event.sender.send('rag:process-progress', {
              stage: '检测到索引变更，正在重建...',
              percent: 80,
              taskType: 'index_rebuild'
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

        event.sender.send('rag:process-progress', {
          stage: `${displayName} 重新索引完成`,
          percent: 100,
          taskType: 'completed'
        })

        return getKnowledgeBaseSnapshot()
      }

      // 文件处理
      event.sender.send('rag:process-progress', {
        stage: `正在重新解析: ${displayName}`,
        percent: 15,
        taskType: 'document_parse'
      })

      const docs = await loadAndSplitFileInWorker(filePath)

      event.sender.send('rag:process-progress', {
        stage: `解析完成，共 ${docs.length} 个片段`,
        percent: 25,
        taskType: 'document_parse'
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
          const percent = 25 + Math.round((progress.progress || 0) * 0.7)
          event.sender.send('rag:process-progress', {
            stage: progress.message,
            percent,
            taskType: progress.taskType
          })
        })
        upsertIndexedFileRecord(record)
      } catch (error) {
        if (isSchemaMismatchError(error)) {
          event.sender.send('rag:process-progress', {
            stage: '检测到索引变更，正在重建...',
            percent: 80,
            taskType: 'index_rebuild'
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

      event.sender.send('rag:process-progress', {
        stage: `${displayName} 重新索引完成`,
        percent: 100,
        taskType: 'completed'
      })

      return getKnowledgeBaseSnapshot()
    } catch (error) {
      console.error('Error reindexing:', error)
      event.sender.send('rag:process-progress', {
        stage: `重新索引失败: ${displayName}`,
        percent: 0,
        error: String(error),
        taskType: 'error'
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
        ? { question: payload, sources: undefined, conversationKey: undefined, tags: undefined }
        : {
            question: payload?.question,
            sources: payload?.sources,
            conversationKey: payload?.conversationKey,
            tags: payload?.tags
          }

    if (!normalized.question) {
      event.reply('rag:chat-error', '问题内容不能为空')
      return
    }

    const normalizePath = (p: string): string => p.replace(/\\/g, '/').toLowerCase()

    // 预处理 sources 和 tags
    if (normalized.sources && normalized.sources.length > 0) {
      const snapshot = getKnowledgeBaseSnapshot()
      const readySet = new Set(
        snapshot.files.filter((f) => f.status === 'ready').map((f) => normalizePath(f.path))
      )

      console.debug('[rag:chat] incoming sources:', normalized.sources)

      const filtered = normalized.sources.filter((s) => readySet.has(normalizePath(s)))

      if (filtered.length === 0) {
        console.debug('[rag:chat] sources filtered out, fallback to full-scope')
        normalized.sources = undefined
      } else {
        normalized.sources = filtered
      }
    }

    try {
      console.log('Chat question:', normalized.question)

      const result = await runLangGraphChat(
        normalized.question,
        normalized.sources,
        normalized.conversationKey,
        (chunk) => event.reply('rag:chat-token', chunk),
        normalized.tags,
        (sources) => event.reply('rag:chat-sources', sources)
      )

      if (result.error) {
        event.reply('rag:chat-error', result.error)
        return
      }

      // 注意：result.sources 已经在 retrieve 阶段通过 onSources 回调发送过了，这里不再重复发送
      // event.reply('rag:chat-sources', result.sources || [])

      if (result.suggestedQuestions && result.suggestedQuestions.length > 0) {
        event.reply('rag:chat-suggestions', result.suggestedQuestions)
      }
      // 注意：不要再次发送 result.answer，因为已经通过 onToken 回调流式发送过了
      // 重复发送会导致前端重复渲染
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

  // LangGraph 版 RAG（一次性响应，不流式）
  ipcMain.handle('rag:chat-graph', async (_, payload) => {
    const normalized =
      typeof payload === 'string'
        ? { question: payload, sources: undefined, conversationKey: undefined, tags: undefined }
        : {
            question: payload?.question,
            sources: payload?.sources,
            conversationKey: payload?.conversationKey,
            tags: payload?.tags
          }

    if (!normalized.question) {
      return { success: false, error: '问题内容不能为空' }
    }

    const result = await runLangGraphChat(
      normalized.question,
      normalized.sources,
      normalized.conversationKey,
      undefined,
      normalized.tags
    )
    if (result.error) {
      return { success: false, error: result.error }
    }

    return {
      success: true,
      answer: result.answer,
      sources: result.sources,
      suggestedQuestions: result.suggestedQuestions
    }
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

  // Update Service IPC
  ipcMain.handle('update:check', async () => {
    setUpdateWindow(mainWindow)
    await checkForUpdates(true)
    return { success: true }
  })

  ipcMain.handle('update:download', async () => {
    try {
      await downloadUpdate()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  ipcMain.handle('update:install', () => {
    installUpdateAndQuit()
    return { success: true }
  })

  ipcMain.handle('update:getStatus', () => {
    return getUpdateStatus()
  })

  // 开发环境下的强制更新检查（调试用）
  ipcMain.handle('update:forceCheckDev', async () => {
    if (process.env.NODE_ENV === 'development') {
      await forceCheckUpdate()
      return { success: true }
    }
    return { success: false, message: '仅在开发环境可用' }
  })

  // Settings IPC
  ipcMain.handle('settings:get', () => {
    return getSettings()
  })

  ipcMain.handle('settings:save', async (event, settings: Partial<AppSettings>) => {
    const oldSettings = getSettings()
    saveSettings(settings)
    const newSettings = getSettings()

    const rerankEnabledBefore = oldSettings.rag?.useRerank ?? false
    const rerankEnabledAfter = newSettings.rag?.useRerank ?? false
    if (!rerankEnabledBefore && rerankEnabledAfter) {
      import('./rag/localReranker')
        .then(({ initLocalReranker }) => initLocalReranker())
        .catch((error) => {
          console.error('Failed to init local reranker after enabling setting:', error)
        })
    }

    // 如果嵌入模型设置变化，清除缓存并通知用户
    if (settings.embeddingProvider !== undefined || settings.embeddingModel !== undefined) {
      const embeddingChanged =
        oldSettings.embeddingProvider !== newSettings.embeddingProvider ||
        oldSettings.embeddingModel !== newSettings.embeddingModel

      if (embeddingChanged) {
        await clearEmbeddingsCache()
        console.log('Embedding settings changed, cache cleared')

        // 自动触发重建索引
        event.sender.send('rag:process-progress', {
          stage: '嵌入模型已更改，正在重建索引...',
          percent: 2,
          taskType: 'index_rebuild'
        })

        refreshKnowledgeBase((progress) => {
          event.sender.send('rag:process-progress', {
            stage: progress.message,
            percent: progress.progress || 0,
            taskType: progress.taskType
          })
        })
          .then(() => {
            event.sender.send('rag:process-progress', {
              stage: '索引重建完成',
              percent: 100,
              taskType: 'completed'
            })
          })
          .catch((error) => {
            console.error('Auto reindex failed:', error)
            event.sender.send('rag:process-progress', {
              stage: '索引重建失败',
              percent: 0,
              error: error instanceof Error ? error.message : String(error),
              taskType: 'error'
            })
          })

        return { success: true, embeddingChanged: true, reindexingStarted: true }
      }
    }

    return { success: true }
  })

  ipcMain.handle('metrics:getRecent', (_, count?: number) => {
    const entries = logger.getRecentEntries(typeof count === 'number' ? count : 100)
    return entries.map((e) => ({
      message: e.message,
      timestamp: e.timestamp,
      context: e.context,
      metadata: e.metadata
    }))
  })

  mainWindow = createWindow()

  // 设置更新窗口
  setUpdateWindow(mainWindow)

  // 监听窗口最大化状态变化
  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', true)
  })

  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:maximized-changed', false)
  })

  mainWindow.on('closed', () => {
    setUpdateWindow(null)
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
    const { closeVectorStore } = await import('./rag/store/index')

    await Promise.all([terminateDocumentWorker(), closeVectorStore()])

    console.log('All workers and resources cleaned up')
  } catch (error) {
    console.error('Error during cleanup:', error)
  } finally {
    app.exit(0)
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
