/**
 * 自动更新服务
 * 处理 Electron 应用的自动更新功能
 */

import { autoUpdater, UpdateInfo } from 'electron-updater'
import { app, dialog, BrowserWindow } from 'electron'
import { logInfo, logError } from './logger'
import { normalizeError } from './errorHandler'

export interface UpdateProgressInfo {
  percent: number
  bytesPerSecond: number
  total: number
  transferred: number
}

export interface UpdateStatus {
  isChecking: boolean
  isDownloading: boolean
  isDownloaded: boolean
  availableVersion?: string
  currentVersion: string
  error?: string
  progress?: UpdateProgressInfo
}

// 全局状态
let updateWindow: BrowserWindow | null = null
let isManualCheck = false
let currentState: UpdateStatus = {
  isChecking: false,
  isDownloading: false,
  isDownloaded: false,
  currentVersion: app.getVersion()
}

// 更新状态管理函数
function updateState(updates: Partial<UpdateStatus>): void {
  currentState = { ...currentState, ...updates }
  // 同时更新窗口状态
  if (updateWindow) {
    updateWindow.webContents.send('update-status-changed', currentState)
  }
}

/**
 * 初始化自动更新器配置
 */
export function initializeAutoUpdater(): void {
  // 开发环境下禁用更新检查
  if (process.env.NODE_ENV === 'development') {
    logInfo('开发环境，跳过自动更新初始化')
    return
  }

  try {
    // 将所有配置移动到 try-catch 中
    // 因为即使是属性赋值也可能触发配置文件读取
    autoUpdater.autoDownload = false // 手动控制下载
    autoUpdater.autoInstallOnAppQuit = true // 退出时自动安装
    autoUpdater.allowPrerelease = false // 只允许正式版
    autoUpdater.allowDowngrade = false // 不允许降级

    setupUpdateEvents()
    logInfo('自动更新服务已初始化')
  } catch (error) {
    if (String(error).includes('app-update.yml')) {
      logInfo('未找到 app-update.yml，跳过自动更新初始化 (开发构建模式)')
      return
    }
    logError('自动更新初始化失败', 'update', { error })
  }
}

/**
 * 设置更新事件监听器
 */
function setupUpdateEvents(): void {
  // 检查更新开始
  autoUpdater.on('checking-for-update', () => {
    logInfo('正在检查更新...')
    updateState({ isChecking: true, error: undefined })
  })

  // 发现可用更新
  autoUpdater.on('update-available', (info: UpdateInfo) => {
    logInfo(`发现新版本: ${info.version}`)
    updateState({
      isChecking: false,
      availableVersion: info.version,
      error: undefined
    })
    notifyUpdateAvailable(info)
  })

  // 未发现更新
  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    logInfo('当前已是最新版本')
    updateState({
      isChecking: false,
      availableVersion: undefined,
      error: undefined
    })
    if (isManualCheck) {
      notifyUpdateNotAvailable(info)
      isManualCheck = false
    }
  })

  // 下载进度
  autoUpdater.on('download-progress', (progress: UpdateProgressInfo) => {
    logInfo(`下载进度: ${Math.round(progress.percent)}%`)
    updateState({
      isDownloading: true,
      progress: progress,
      error: undefined
    })
    notifyDownloadProgress(progress)
  })

  // 下载完成
  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    logInfo(`更新下载完成: ${info.version}`)
    updateState({
      isDownloading: false,
      isDownloaded: true,
      availableVersion: info.version,
      error: undefined
    })
    notifyUpdateDownloaded(info)
  })

  // 错误处理
  autoUpdater.on('error', (error: Error) => {
    const errorInfo = normalizeError(error)
    logError('更新错误', 'update', { error: errorInfo.message, details: errorInfo.details })
    updateState({
      isChecking: false,
      isDownloading: false,
      error: errorInfo.message
    })
    notifyUpdateError(errorInfo.message)
  })
}

/**
 * 检查更新（自动或手动）
 */
export async function checkForUpdates(manual: boolean = false): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    logInfo('开发环境，跳过更新检查')
    // 开发环境不弹窗，只记录日志
    return
  }

  isManualCheck = manual
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const errorInfo = normalizeError(error)
    logError('检查更新失败', 'update', { error: errorInfo.message, details: errorInfo.details })
    // 不再弹出对话框，通过状态更新通知渲染进程
    updateState({
      isChecking: false,
      error: errorInfo.message || '检查更新失败'
    })
  }
}

/**
 * 下载更新
 */
export async function downloadUpdate(): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    logInfo('开发环境，跳过更新下载')
    return
  }

  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    const errorInfo = normalizeError(error)
    logError('下载更新失败', 'update', { error: errorInfo.message, details: errorInfo.details })
    throw new Error(errorInfo.userFriendly || errorInfo.message)
  }
}

/**
 * 安装更新并重启应用
 */
export function installUpdateAndQuit(): void {
  if (process.env.NODE_ENV === 'development') {
    logInfo('开发环境，跳过更新安装')
    return
  }

  logInfo('准备安装更新并退出应用')
  autoUpdater.quitAndInstall(false, true)
}

/**
 * 通知更新可用
 */
function notifyUpdateAvailable(info: UpdateInfo): void {
  if (updateWindow) {
    updateWindow.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes,
      releaseDate: info.releaseDate
    })
  }
  // 不再显示弹窗，通过渲染进程状态消息显示
}

/**
 * 通知没有可用更新
 */
function notifyUpdateNotAvailable(info: UpdateInfo): void {
  if (updateWindow) {
    updateWindow.webContents.send('update-not-available', {
      currentVersion: info.version
    })
  }
  // 不再显示弹窗，通过渲染进程状态消息显示
}

/**
 * 通知下载进度
 */
function notifyDownloadProgress(progress: UpdateProgressInfo): void {
  if (updateWindow) {
    updateWindow.webContents.send('download-progress', progress)
  }
}

/**
 * 通知更新下载完成
 */
function notifyUpdateDownloaded(info: UpdateInfo): void {
  if (updateWindow) {
    updateWindow.webContents.send('update-downloaded', {
      version: info.version
    })
  }
  // 不再显示弹窗，通过渲染进程状态消息显示
}

/**
 * 通知更新错误
 */
function notifyUpdateError(error: string): void {
  if (updateWindow) {
    updateWindow.webContents.send('update-error', { error })
  }
}

/**
 * 设置更新窗口（用于接收渲染进程消息）
 */
export function setUpdateWindow(window: BrowserWindow | null): void {
  updateWindow = window
}

/**
 * 获取当前更新状态
 */
export function getUpdateStatus(): UpdateStatus {
  return currentState
}

/**
 * 强制检查更新（用于调试）
 */
export async function forceCheckUpdate(): Promise<void> {
  if (process.env.NODE_ENV !== 'development') {
    return
  }

  // 模拟更新检查
  const result = await dialog.showMessageBox({
    type: 'question',
    title: '开发环境 - 模拟更新',
    message: '模拟更新检查',
    detail: '选择要模拟的场景',
    buttons: ['发现更新', '已是最新', '下载失败', '取消'],
    defaultId: 0
  })

  switch (result.response) {
    case 0: // 发现更新
      notifyUpdateAvailable({
        version: '1.0.2',
        releaseNotes: '修复了一些bug，优化了性能',
        releaseDate: new Date().toISOString()
      } as UpdateInfo)
      break
    case 1: // 已是最新
      notifyUpdateNotAvailable({
        version: app.getVersion()
      } as UpdateInfo)
      break
    case 2: // 下载失败
      notifyUpdateError('模拟下载失败：网络连接超时')
      break
    case 3: // 取消
      break
  }
}
