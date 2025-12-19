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
  // 配置更新器
  autoUpdater.autoDownload = false // 手动控制下载
  autoUpdater.autoInstallOnAppQuit = true // 退出时自动安装
  autoUpdater.allowPrerelease = false // 只允许正式版
  autoUpdater.allowDowngrade = false // 不允许降级

  // 开发环境下禁用更新检查
  if (process.env.NODE_ENV === 'development') {
    logInfo('开发环境，跳过自动更新初始化')
    return
  }

  setupUpdateEvents()
  logInfo('自动更新服务已初始化')
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
    if (manual) {
      dialog.showMessageBox({
        type: 'info',
        title: '开发环境',
        message: '开发环境下无法检查更新',
        detail: '请在生产环境下测试更新功能'
      })
    }
    return
  }

  isManualCheck = manual
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    const errorInfo = normalizeError(error)
    logError('检查更新失败', 'update', { error: errorInfo.message, details: errorInfo.details })
    if (manual) {
      dialog.showErrorBox('检查更新失败', errorInfo.message || '未知错误')
    }
  }
}

/**
 * 下载更新
 */
export async function downloadUpdate(): Promise<void> {
  if (process.env.NODE_ENV === 'development') {
    dialog.showMessageBox({
      type: 'info',
      title: '开发环境',
      message: '开发环境下无法下载更新'
    })
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
    dialog.showMessageBox({
      type: 'info',
      title: '开发环境',
      message: '开发环境下无法安装更新'
    })
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

  // 如果是手动检查，显示对话框
  if (isManualCheck) {
    dialog
      .showMessageBox({
        type: 'info',
        title: '发现新版本',
        message: `发现新版本: ${info.version}`,
        detail: '是否现在下载更新？',
        buttons: ['下载更新', '稍后再说'],
        defaultId: 0
      })
      .then((result) => {
        if (result.response === 0) {
          downloadUpdate()
        }
      })
  }
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

  dialog.showMessageBox({
    type: 'info',
    title: '检查更新',
    message: '当前已是最新版本',
    detail: `当前版本: ${info.version}`
  })
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

  dialog
    .showMessageBox({
      type: 'info',
      title: '更新已下载',
      message: '更新已下载完成',
      detail: '是否立即安装并重启应用？',
      buttons: ['立即安装', '稍后安装'],
      defaultId: 0
    })
    .then((result) => {
      if (result.response === 0) {
        installUpdateAndQuit()
      }
    })
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
