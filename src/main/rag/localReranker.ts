/**
 * 本地重排序模型模块
 * 使用 Worker 线程运行 @huggingface/transformers 实现本地 Cross-Encoder 重排序
 */
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { initRerankerInWorker, rerankInWorker } from './workerManager'
import { ProgressCallback, ProgressStatus, TaskType } from './progressTypes'
import { RAG_CONFIG } from '../utils/config'

// 配置模型缓存路径
const getModelsPath = (): string => {
  const userDataPath = app?.getPath ? app.getPath('userData') : process.cwd()
  const modelsPath = path.join(userDataPath, 'models')
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true })
  }
  return modelsPath
}

export const LOCAL_RERANKER_MODELS = {
  'bge-reranker-base': 'Xenova/bge-reranker-base',
  'bge-reranker-v2-m3': 'Xenova/bge-reranker-v2-m3'
} as const

export type LocalRerankerModelName = keyof typeof LOCAL_RERANKER_MODELS

let cachedModelName: string | null = null
let isInitializing = false
let initPromise: Promise<void> | null = null

/**
 * 初始化本地重排序模型
 */
export async function initLocalReranker(
  modelName: LocalRerankerModelName = 'bge-reranker-base',
  onProgress?: ProgressCallback
): Promise<void> {
  const modelId = LOCAL_RERANKER_MODELS[modelName]

  if (cachedModelName === modelId) return

  if (isInitializing && initPromise) {
    return initPromise
  }

  isInitializing = true

  initPromise = (async () => {
    try {
      const modelsPath = getModelsPath()

      onProgress?.({
        status: ProgressStatus.DOWNLOADING,
        progress: 10,
        message: `正在加载重排序模型 ${modelName}...`,
        taskType: TaskType.MODEL_DOWNLOAD
      })

      await initRerankerInWorker(modelId, modelsPath, (payload) => {
        onProgress?.(payload as any)
      })

      cachedModelName = modelId
      isInitializing = false
      initPromise = null

      onProgress?.({
        status: ProgressStatus.READY,
        progress: 100,
        message: '重排序模型加载完成',
        taskType: TaskType.MODEL_DOWNLOAD
      })
    } catch (error) {
      isInitializing = false
      initPromise = null
      cachedModelName = null
      throw error
    }
  })()

  return initPromise
}

/**
 * 执行重排序
 */
export async function rerank(
  query: string,
  documents: string[],
  options: {
    modelName?: LocalRerankerModelName
    topK?: number
  } = {}
): Promise<{ index: number; score: number }[]> {
  const modelName =
    options.modelName || (RAG_CONFIG.RERANK.MODEL as LocalRerankerModelName) || 'bge-reranker-base'

  await initLocalReranker(modelName)

  const scores = await rerankInWorker(query, documents)

  // 映射回索引和分数，并排序
  const results = scores.map((score, index) => ({ index, score }))
  results.sort((a, b) => b.score - a.score)

  if (options.topK) {
    return results.slice(0, options.topK)
  }

  return results
}
