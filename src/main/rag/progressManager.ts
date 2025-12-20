import { MessagePort } from 'worker_threads'
import { ProgressStatus, TaskType } from './progressTypes'
import { extractResolvedFilePath } from './utils/network'
import {
  extractFileBaseName,
  getDisplayFileName
} from './modelUtils'

// 文件下载状态接口
export interface FileDownloadState {
  loaded: number // 已下载字节数
  total: number // 文件总字节数
  completed: boolean // 是否下载完成
}

// 进度消息接口，与前端保持一致
export interface ProgressMessage {
  id: string
  type: 'progress'
  payload: {
    taskType: string
    status: ProgressStatus
    message: string
    progress: number // 0-100的整数
    stage: string // 与前端ProcessProgress.stage字段对应
    file?: string // 当前正在下载的文件
    fileName?: string // 用户可读的文件名/类型
    fileProgress?: number // 0-1的小数
    error?: string // 错误信息
  }
}

export class ProgressManager {
  private fileStates = new Map<string, FileDownloadState>()
  private lastReportedGlobalProgress = 0
  private progressUpdateThrottle = 0
  private fileKeyAliases = new Map<string, string>()

  // 配置参数
  private readonly THROTTLE_INTERVAL = 100 // 进度更新节流间隔（毫秒）
  private readonly MIN_PROGRESS_CHANGE = 1 // 最小进度变化（百分比）

  constructor(
    private taskId: string,
    private taskType: TaskType,
    private parentPort: MessagePort | null
  ) {}

  public getFileStates() {
    return this.fileStates
  }

  public getLastReportedProgress() {
    return this.lastReportedGlobalProgress
  }

  private resolveFileKey(input: string): string {
    if (this.fileStates.has(input)) return input
    const cached = this.fileKeyAliases.get(input)
    if (cached && this.fileStates.has(cached)) return cached

    const base = extractFileBaseName(input)
    const matches: string[] = []
    for (const key of this.fileStates.keys()) {
      if (extractFileBaseName(key) === base) {
        matches.push(key)
      }
    }

    if (matches.length === 0) return input
    const direct = matches.find((k) => k.endsWith(`/${input}`))
    const chosen = direct ?? matches[0]!
    this.fileKeyAliases.set(input, chosen)
    return chosen
  }

  public calculateProgress(): number {
    if (this.fileStates.size === 0) return 0

    let knownLoaded = 0
    let knownTotal = 0
    let knownCount = 0
    let unknownCount = 0
    let unknownCompleted = 0
    let completedFiles = 0

    for (const [, state] of this.fileStates.entries()) {
      if (state.completed) completedFiles++

      if (state.total > 0) {
        knownCount++
        knownTotal += state.total
        knownLoaded += Math.min(state.loaded, state.total)
      } else {
        unknownCount++
        if (state.completed) unknownCompleted++
      }
    }

    // 计算完成百分比
    let progress = 0

    if (knownTotal <= 0) {
      progress = (completedFiles / this.fileStates.size) * 100
    } else if (unknownCount === 0) {
      progress = (knownLoaded / knownTotal) * 100
    } else {
      const avgKnownSize = knownCount > 0 ? knownTotal / knownCount : knownTotal
      const estimatedTotal = knownTotal + avgKnownSize * unknownCount
      const estimatedLoaded = knownLoaded + avgKnownSize * unknownCompleted
      progress = (estimatedLoaded / Math.max(estimatedTotal, 1)) * 100
    }

    return Math.round(progress)
  }

  public sendUpdate(
    status: ProgressStatus,
    message: string,
    file?: string,
    fileProgress?: number
  ) {
    // 节流控制，避免闪烁
    const now = Date.now()

    // 计算当前进度
    const currentProgress = this.calculateProgress()

    // 确保进度只增不减
    const isCompleted = status === ProgressStatus.COMPLETED
    const rawFinalProgress = Math.max(currentProgress, this.lastReportedGlobalProgress)
    const finalProgress = isCompleted ? 100 : Math.min(99, rawFinalProgress)

    // 检查是否需要更新进度
    const progressChanged =
      finalProgress - this.lastReportedGlobalProgress >= this.MIN_PROGRESS_CHANGE
    const isError = status === ProgressStatus.ERROR

    // 如果进度变化不大且不是完成或错误状态，并且在节流间隔内，则不更新
    if (!progressChanged && !isCompleted && !isError) {
      if (now - this.progressUpdateThrottle < this.THROTTLE_INTERVAL) {
        return
      }
    }

    // 更新最后报告的进度和时间
    this.lastReportedGlobalProgress = finalProgress
    this.progressUpdateThrottle = now

    // 构建进度消息，确保与前端ProcessProgress接口完全一致
    const progressMessage: ProgressMessage = {
      id: this.taskId,
      type: 'progress',
      payload: {
        taskType: this.taskType,
        status,
        // 使用progress字段（0-100）而不是percent
        progress: isCompleted ? 100 : Math.max(0, Math.min(99, Math.round(finalProgress))),
        // 前端使用stage字段作为进度描述
        stage: message,
        // 错误状态时设置error字段
        error: isError ? message : undefined,
        // 保留原始message字段作为兼容
        message,
        file,
        fileName: file ? getDisplayFileName(file) : undefined,
        fileProgress:
          fileProgress !== undefined ? Math.max(0, Math.min(1, fileProgress)) : undefined
      }
    }

    // 发送进度消息
    this.parentPort?.postMessage(progressMessage)
  }

  // Transformers.js progress callback
  public customProgressCallback = (progress: Record<string, unknown>) => {
    const status = typeof progress.status === 'string' ? progress.status : ''
    const rawFile =
      typeof progress.file === 'string'
        ? progress.file
        : typeof progress.name === 'string'
          ? progress.name
          : typeof progress.url === 'string'
            ? progress.url
            : undefined
    const fileRaw =
      rawFile && /^https?:\/\//i.test(rawFile)
        ? (extractResolvedFilePath(rawFile) ?? extractFileBaseName(rawFile))
        : rawFile
    const file = fileRaw ? this.resolveFileKey(fileRaw) : fileRaw
    const loaded =
      typeof progress.loaded === 'number'
        ? progress.loaded
        : typeof progress.loaded === 'string'
          ? Number(progress.loaded)
          : undefined
    const total =
      typeof progress.total === 'number'
        ? progress.total
        : typeof progress.total === 'string'
          ? Number(progress.total)
          : undefined

    // 初始化文件状态
    if (file && !this.fileStates.has(file)) {
      this.fileStates.set(file, {
        loaded: 0,
        total: total ?? 0,
        completed: false
      })
    }

    // 更新文件状态
    if (file && this.fileStates.has(file)) {
      const state = this.fileStates.get(file)! as FileDownloadState
      const displayFileName = getDisplayFileName(file)

      switch (status) {
        case 'initiate':
          // 开始下载新文件
          state.total = total ?? state.total
          this.sendUpdate(ProgressStatus.DOWNLOADING, `开始下载: ${displayFileName}`, file)
          break

        case 'download':
        case 'progress': {
          // 更新下载进度
          state.loaded = loaded ?? state.loaded
          state.total = total ?? state.total

          // 计算当前文件进度
          const currentFileProgress = state.total > 0 ? state.loaded / state.total : 0

          // 构建消息，显示文件名称、进度和大小
          const loadedMB = (state.loaded / (1024 * 1024)).toFixed(2)
          const totalMB = state.total > 0 ? (state.total / (1024 * 1024)).toFixed(2) : '未知'
          const fileProgressPercent = (currentFileProgress * 100).toFixed(1)

          const message = `下载中: ${displayFileName} (${fileProgressPercent}%, ${loadedMB}MB / ${totalMB}MB)`

          this.sendUpdate(ProgressStatus.DOWNLOADING, message, file, currentFileProgress)
          break
        }

        case 'done': {
          // 文件下载完成
          state.loaded = (total ?? loaded ?? state.loaded) as number
          state.total = total ?? state.total
          state.completed = true

          // 更新全局状态
          const completedFiles = Array.from(this.fileStates.values()).filter(
            (s) => s.completed
          ).length
          const allFilesDownloaded =
            completedFiles === this.fileStates.size && this.fileStates.size > 0

          this.sendUpdate(ProgressStatus.DOWNLOADING, `文件下载完成: ${displayFileName}`, file, 1)

          // 如果所有文件都下载完成，这里不直接发送完成消息，而是由调用者决定
          if (allFilesDownloaded) {
             this.sendUpdate(ProgressStatus.PROCESSING, `所有文件下载完成，正在验证...`)
          }
          break
        }
      }
    }
  }
}
