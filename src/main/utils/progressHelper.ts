/**
 * 进度消息辅助函数
 * 统一进度消息格式，避免代码重复
 *
 * 设计原则：
 * 1. 用户友好的描述：使用通俗易懂的语言
 * 2. 清晰的阶段指示：让用户知道当前在哪个步骤
 * 3. 进度量化：尽可能显示具体的数字进度
 */

import type { WebContents } from 'electron'
import { ProgressMessage, ProgressStatus, TaskType } from '../rag/progressTypes'

/** 任务类型的用户友好名称 */
const TASK_TYPE_LABELS: Record<string, string> = {
  [TaskType.MODEL_DOWNLOAD]: '下载嵌入模型',
  [TaskType.RERANKER_DOWNLOAD]: '下载重排序模型',
  [TaskType.DOCUMENT_PARSE]: '解析文档',
  [TaskType.DOCUMENT_SPLIT]: '分割文档',
  [TaskType.EMBEDDING_GENERATION]: '生成向量',
  [TaskType.INDEX_REBUILD]: '重建索引',
  [TaskType.KNOWLEDGE_BASE_BUILD]: '构建知识库',
  [TaskType.UNKNOWN]: '处理中'
}

/**
 * 获取任务类型的用户友好名称
 */
export function getTaskTypeLabel(taskType: TaskType): string {
  return TASK_TYPE_LABELS[taskType] || '处理中'
}

/**
 * 格式化文件名（截取过长的文件名）
 */
function formatFileName(fileName: string, maxLength: number = 30): string {
  if (!fileName) return ''
  if (fileName.length <= maxLength) return fileName

  const ext = fileName.includes('.') ? fileName.split('.').pop() : ''
  const nameWithoutExt = ext ? fileName.slice(0, -(ext.length + 1)) : fileName
  const availableLength = maxLength - (ext ? ext.length + 4 : 3) // 4 = "..." + "."

  if (availableLength <= 0) return fileName.slice(0, maxLength - 3) + '...'

  return nameWithoutExt.slice(0, availableLength) + '...' + (ext ? '.' + ext : '')
}

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
  const formattedFileName = formatFileName(fileName, 25)
  const defaultMessage = `下载模型文件: ${formattedFileName} (${Math.round(progress)}%)`

  return createProgressMessage(
    TaskType.MODEL_DOWNLOAD,
    ProgressStatus.DOWNLOADING,
    message || defaultMessage,
    { progress, fileName }
  )
}

/**
 * 创建文档解析进度消息
 */
export function createDocumentParseProgress(
  progress: number,
  fileName: string,
  options?: {
    currentFile?: number
    totalFiles?: number
    chunkCount?: number
  }
): ProgressMessage {
  const formattedFileName = formatFileName(fileName, 20)
  let message = `正在解析: ${formattedFileName}`

  if (options?.currentFile && options?.totalFiles) {
    message = `正在解析 (${options.currentFile}/${options.totalFiles}): ${formattedFileName}`
  }

  return createProgressMessage(TaskType.DOCUMENT_PARSE, ProgressStatus.PROCESSING, message, {
    progress,
    fileName,
    processedCount: options?.currentFile,
    totalCount: options?.totalFiles
  })
}

/**
 * 创建文档解析完成消息
 */
export function createDocumentParseComplete(
  chunkCount: number,
  fileName?: string
): ProgressMessage {
  const formattedFileName = fileName ? formatFileName(fileName, 15) : ''
  const message = formattedFileName
    ? `${formattedFileName} 解析完成，共 ${chunkCount} 个片段`
    : `文档解析完成，共 ${chunkCount} 个片段`

  return createProgressMessage(TaskType.DOCUMENT_PARSE, ProgressStatus.PROCESSING, message, {
    progress: 30
  })
}

/**
 * 创建向量生成进度消息
 */
export function createEmbeddingProgress(
  progress: number,
  processedCount: number,
  totalCount: number
): ProgressMessage {
  return createProgressMessage(
    TaskType.EMBEDDING_GENERATION,
    ProgressStatus.PROCESSING,
    `生成向量中 (${processedCount}/${totalCount})`,
    {
      progress,
      processedCount,
      totalCount
    }
  )
}

/**
 * 创建索引重建进度消息
 */
export function createIndexRebuildProgress(progress: number, message?: string): ProgressMessage {
  return createProgressMessage(
    TaskType.INDEX_REBUILD,
    ProgressStatus.PROCESSING,
    message || `正在重建索引 (${progress}%)`,
    { progress }
  )
}

/**
 * 创建处理进度消息（通用）
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
  return createProgressMessage(taskType, ProgressStatus.PROCESSING, message, {
    progress,
    fileName: options?.fileName,
    processedCount: options?.processedCount,
    totalCount: options?.totalCount
  })
}

/**
 * 创建完成消息
 */
export function createCompletedMessage(taskType: TaskType, message?: string): ProgressMessage {
  const defaultMessages: Record<string, string> = {
    [TaskType.MODEL_DOWNLOAD]: '模型下载完成',
    [TaskType.DOCUMENT_PARSE]: '文档解析完成',
    [TaskType.DOCUMENT_SPLIT]: '文档分割完成',
    [TaskType.EMBEDDING_GENERATION]: '向量生成完成',
    [TaskType.INDEX_REBUILD]: '索引重建完成',
    [TaskType.KNOWLEDGE_BASE_BUILD]: '知识库构建完成'
  }

  return createProgressMessage(
    taskType,
    ProgressStatus.COMPLETED,
    message || defaultMessages[taskType] || '处理完成',
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
  // 优化错误消息，避免显示过于技术化的内容
  let userFriendlyMessage = message

  if (message.includes('ENOENT') || message.includes('no such file')) {
    userFriendlyMessage = '文件未找到'
  } else if (message.includes('EACCES') || message.includes('permission denied')) {
    userFriendlyMessage = '权限不足，无法访问文件'
  } else if (message.includes('ECONNREFUSED') || message.includes('network')) {
    userFriendlyMessage = '网络连接失败'
  } else if (message.includes('timeout')) {
    userFriendlyMessage = '操作超时，请重试'
  }

  return createProgressMessage(taskType, ProgressStatus.ERROR, userFriendlyMessage, { progress: 0 })
}

/**
 * 将 ProgressMessage 转换为前端期望的格式（兼容旧代码）
 */
export function toFrontendProgressFormat(progress: ProgressMessage): {
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

/**
 * 创建批量处理进度消息
 * 用于显示多文件处理时的整体进度
 */
export function createBatchProgress(
  taskType: TaskType,
  currentFile: number,
  totalFiles: number,
  currentFileName: string,
  innerProgress: number = 0
): ProgressMessage {
  const overallProgress = Math.round(
    ((currentFile - 1) / totalFiles) * 100 + innerProgress / totalFiles
  )
  const formattedFileName = formatFileName(currentFileName, 18)

  return createProgressMessage(
    taskType,
    ProgressStatus.PROCESSING,
    `处理中 (${currentFile}/${totalFiles}): ${formattedFileName}`,
    {
      progress: Math.min(overallProgress, 99),
      fileName: currentFileName,
      processedCount: currentFile,
      totalCount: totalFiles
    }
  )
}

export type FrontendProcessProgressPayload = {
  stage: string
  percent: number
  taskType?: string
  error?: string
}

function normalizeFrontendProcessProgressPayload(
  payload: FrontendProcessProgressPayload
): FrontendProcessProgressPayload {
  const percentRaw =
    typeof payload.percent === 'number' && Number.isFinite(payload.percent) ? payload.percent : 0
  const percent = Math.max(0, Math.min(100, percentRaw))
  return {
    ...payload,
    stage: typeof payload.stage === 'string' ? payload.stage : '',
    percent
  }
}

export function sendRagProcessProgress(
  webContents: WebContents,
  payload: FrontendProcessProgressPayload
): void {
  webContents.send('rag:process-progress', normalizeFrontendProcessProgressPayload(payload))
}

export function sendRagProcessProgressMessage(
  webContents: WebContents,
  progress: ProgressMessage,
  overrides?: Partial<FrontendProcessProgressPayload>
): void {
  const base = toFrontendProgressFormat(progress)
  sendRagProcessProgress(webContents, { ...base, ...overrides })
}
