/**
 * 进度消息辅助函数
 * 统一进度消息格式，避免代码重复
 */

import { ProgressMessage, ProgressStatus, TaskType } from '../rag/progressTypes'

/**
 * 创建进度消息的辅助函数
 */
export function createProgressMessage(
  taskType: TaskType,
  status: ProgressStatus,
  message: string,
  options?: {
    progress?: number
    fileName?: string
    step?: string
    eta?: number
    processedCount?: number
    totalCount?: number
    currentIndex?: number
  }
): ProgressMessage {
  return {
    taskType,
    status,
    message,
    progress: options?.progress,
    fileName: options?.fileName,
    step: options?.step,
    eta: options?.eta,
    processedCount: options?.processedCount,
    totalCount: options?.totalCount,
    currentIndex: options?.currentIndex
  }
}

/**
 * 创建下载进度消息
 */
export function createDownloadProgress(
  progress: number,
  fileName: string,
  message?: string
): ProgressMessage {
  return createProgressMessage(
    TaskType.MODEL_DOWNLOAD,
    ProgressStatus.DOWNLOADING,
    message || `下载中: ${fileName} (${Math.round(progress)}%)`,
    { progress, fileName }
  )
}

/**
 * 创建处理进度消息
 */
export function createProcessingProgress(
  taskType: TaskType,
  progress: number,
  message: string,
  options?: {
    fileName?: string
    processedCount?: number
    totalCount?: number
  }
): ProgressMessage {
  return createProgressMessage(
    taskType,
    ProgressStatus.PROCESSING,
    message,
    {
      progress,
      fileName: options?.fileName,
      processedCount: options?.processedCount,
      totalCount: options?.totalCount
    }
  )
}

/**
 * 创建完成消息
 */
export function createCompletedMessage(
  taskType: TaskType,
  message?: string
): ProgressMessage {
  return createProgressMessage(
    taskType,
    ProgressStatus.COMPLETED,
    message || '完成',
    { progress: 100 }
  )
}

/**
 * 创建错误消息
 */
export function createErrorMessage(
  taskType: TaskType,
  message: string,
  _error?: Error
): ProgressMessage {
  return createProgressMessage(
    taskType,
    ProgressStatus.ERROR,
    message,
    { progress: 0 }
  )
}

/**
 * 将 ProgressMessage 转换为前端期望的格式（兼容旧代码）
 */
export function toFrontendProgressFormat(
  progress: ProgressMessage
): {
  stage: string
  percent: number
  taskType?: string
  error?: string
} {
  return {
    stage: progress.message,
    percent: progress.progress || 0,
    taskType: progress.taskType,
    error: progress.status === ProgressStatus.ERROR ? progress.message : undefined
  }
}

