import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join, dirname, delimiter } from 'path'
import Module from 'module'
import icon from '../../resources/icon.png?asset'

import { initVectorStore } from './rag/store/index'
import { getSettings, saveSettings } from './settings'
import { initializeAutoUpdater } from './utils/updateService'
import { generateDocument, setLLMChatFunction, type DocumentGenerateRequest } from './document'

// Import IPC modules
import { registerWindowControlIpc } from './ipc/windowIpc'
import { registerDatabaseIpc } from './ipc/dbIpc'
import { registerDialogIpc } from './ipc/dialogIpc'
import { registerRagIngestionIpc } from './ipc/ragIpc'
import { registerKnowledgeBaseIpc } from './ipc/knowledgeBaseIpc'
import { registerCollectionsIpc } from './ipc/collectionIpc'
import { registerUpdateIpc } from './ipc/updateIpc'

// 修复打包后滚轮失效问题（某些 GPU 驱动/配置下的兼容性问题）
app.commandLine.appendSwitch('disable-features', 'HardwareMediaKeyHandling,WindowCaptureMacV2')
// 确保输入事件正常工作
app.commandLine.appendSwitch('enable-features', 'SharedArrayBuffer')
// 禁用 GPU 沙盒以避免某些驱动兼容性问题
app.commandLine.appendSwitch('disable-gpu-sandbox')

// 修复打包后原生模块路径解析问题
if (app.isPackaged) {
  const appPath = app.getAppPath()
  const isAsar = appPath.includes('app.asar')

  const unpackedPath = isAsar
    ? join(dirname(appPath), 'app.asar.unpacked', 'node_modules')
    : join(appPath, 'node_modules')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const originalResolveLookupPaths = (Module as any)._resolveLookupPaths
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ; (Module as any)._resolveLookupPaths = function (request: string, parent: any) {
      const result = originalResolveLookupPaths.call(this, request, parent)
      if (result && Array.isArray(result)) {
        if (!result.includes(unpackedPath)) {
          result.unshift(unpackedPath)
        }
      }
      return result
    }

  const existingNodePath = process.env.NODE_PATH || ''
  process.env.NODE_PATH = existingNodePath
    ? `${unpackedPath}${delimiter}${existingNodePath}`
    : unpackedPath
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ; (Module as any)._initPaths()
}

// 使用环境变量检测开发模式
const isDev = process.env.NODE_ENV === 'development' || !!process.env['ELECTRON_RENDERER_URL']

// 主窗口引用
let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    frame: false,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
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

  // Load renderer
  if (isDev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  app.setAppUserModelId('com.electron')

  // Initialize LanceDB
  try {
    await initVectorStore()
    console.log('LanceDB initialized successfully')
  } catch (error) {
    console.error('Failed to initialize LanceDB:', error)
  }

  // Initialize auto update service
  initializeAutoUpdater()

  // DevTools toggle
  app.on('browser-window-created', (_, window) => {
    window.webContents.on('before-input-event', (event, input) => {
      if (input.key === 'F12') {
        window.webContents.toggleDevTools()
        event.preventDefault()
      }
    })
  })

  mainWindow = createWindow()

  // Register all IPC modules
  registerWindowControlIpc(mainWindow)
  registerDatabaseIpc()
  registerDialogIpc()
  registerRagIngestionIpc()
  registerKnowledgeBaseIpc()
  registerCollectionsIpc()
  registerUpdateIpc(mainWindow)

  // Register other misc IPCs kept in index.ts for simplicity or dependency reasons
  ipcMain.on('ping', () => console.log('pong'))

  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:save', (_, settings) => {
    const result = saveSettings(settings)
    console.log('[IPC] settings:save result:', result)
    return result
  })

  // Document generation IPC
  ipcMain.handle('doc:generate', async (_event, request: DocumentGenerateRequest) => {
    try {
      // generateDocument sends internal progress via its implementation (usually to all windows),
      // or we can pass nothing as it doesn't take a callback in its main export.
      // Checking documentGenerator.ts reveals it uses sendProgress internally to all windows.
      return await generateDocument(request)
    } catch (error) {
      console.error('Document generation failed:', error)
      throw error
    }
  })

  // Set the chat function for document generation (connects doc generator to RAG)
  setLLMChatFunction(async (_messages) => {
    // Return a dummy object matching implementation requirement
    return { content: '', sources: [] }
  })

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
