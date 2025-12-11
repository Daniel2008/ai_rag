/**
 * 嵌入模型管理
 */

import { OllamaEmbeddings } from '@langchain/ollama'
import type { Embeddings } from '@langchain/core/embeddings'
import { BrowserWindow } from 'electron'
import { getSettings } from '../../settings'
import {
  LocalEmbeddings,
  setProgressCallback,
  type LocalEmbeddingModelName,
  type ModelProgressCallback
} from '../localEmbeddings'
import { ProgressStatus, TaskType } from '../progressTypes'
import type { ProgressCallback } from './types'
import { logInfo } from '../../utils/logger'

// 缓存 Embeddings 实例
let cachedEmbeddings: Embeddings | null = null
let cachedEmbeddingsConfig: { provider: string; model: string; baseUrl?: string } | null = null
let embeddingsInitPromise: Promise<Embeddings> | null = null

// 进度抑制计数
let embeddingProgressSuppressionCount = 0

export function isEmbeddingProgressSuppressed(): boolean {
  return embeddingProgressSuppressionCount > 0
}

export async function withEmbeddingProgressSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  embeddingProgressSuppressionCount++
  try {
    return await fn()
  } finally {
    embeddingProgressSuppressionCount = Math.max(0, embeddingProgressSuppressionCount - 1)
  }
}

export function setEmbeddingProgressSuppressed(suppressed: boolean): void {
  embeddingProgressSuppressionCount = Math.max(
    0,
    suppressed ? embeddingProgressSuppressionCount + 1 : embeddingProgressSuppressionCount - 1
  )
}

/**
 * 发送嵌入模型进度到渲染进程
 */
function sendEmbeddingProgress(progress: Parameters<ModelProgressCallback>[0]): void {
  if (isEmbeddingProgressSuppressed()) {
    return
  }

  if (BrowserWindow?.getAllWindows) {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('embedding:progress', progress)
    })
  } else {
    logInfo('Embedding progress', 'EmbeddingProgress', {
      status: progress.status,
      message: progress.message,
      progress: progress.progress
    })
  }
}

/**
 * 获取嵌入模型实例（带缓存）
 */
export function getEmbeddings(): Embeddings {
  const settings = getSettings()
  const currentConfig = {
    provider: settings.embeddingProvider,
    model: settings.embeddingModel,
    baseUrl: settings.ollamaUrl
  }

  // 检查配置是否变化
  if (
    cachedEmbeddings &&
    cachedEmbeddingsConfig &&
    cachedEmbeddingsConfig.provider === currentConfig.provider &&
    cachedEmbeddingsConfig.model === currentConfig.model &&
    cachedEmbeddingsConfig.baseUrl === currentConfig.baseUrl
  ) {
    return cachedEmbeddings
  }

  // 如果正在初始化且配置未变化，清除等待
  if (embeddingsInitPromise) {
    embeddingsInitPromise = null
  }

  // 根据提供者创建不同的嵌入实例
  if (currentConfig.provider === 'local') {
    setProgressCallback(sendEmbeddingProgress)
    cachedEmbeddings = new LocalEmbeddings({
      modelName: currentConfig.model as LocalEmbeddingModelName,
      onProgress: sendEmbeddingProgress
    })
  } else {
    cachedEmbeddings = new OllamaEmbeddings({
      model: currentConfig.model,
      baseUrl: currentConfig.baseUrl
    })
  }

  cachedEmbeddingsConfig = currentConfig
  return cachedEmbeddings
}

/**
 * 确保嵌入模型已初始化
 */
export async function ensureEmbeddingsInitialized(onProgress?: ProgressCallback): Promise<void> {
  const embeddings = getEmbeddings()

  if (embeddings instanceof LocalEmbeddings) {
    if (onProgress) {
      embeddings.setTempProgressCallback((progress) => {
        if (
          progress.taskType === TaskType.MODEL_DOWNLOAD ||
          progress.status === ProgressStatus.DOWNLOADING
        ) {
          onProgress(progress)
        } else if (progress.status === ProgressStatus.PROCESSING) {
          onProgress(progress)
        }
      })
    }

    try {
      await embeddings.initialize()
    } finally {
      if (onProgress) {
        embeddings.setTempProgressCallback(undefined)
      }
    }
  }
}

/**
 * 清除嵌入模型缓存
 */
export async function clearEmbeddingsCache(): Promise<void> {
  cachedEmbeddings = null
  cachedEmbeddingsConfig = null
  embeddingsInitPromise = null

  // 清除本地模型缓存
  const localEmbeddings = await import('../localEmbeddings')
  localEmbeddings.clearModelCache()
  console.log('Embeddings cache cleared')
}
