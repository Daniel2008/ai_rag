/**
 * 本地嵌入模型模块
 * 使用 Worker 线程运行 @huggingface/transformers 实现不依赖 Ollama 的本地嵌入
 */
import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { initEmbeddingInWorker, embedInWorker } from './workerManager'

// 配置模型缓存路径到应用数据目录
const getModelsPath = (): string => {
  const userDataPath = app.getPath('userData')
  const modelsPath = path.join(userDataPath, 'models')
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true })
  }
  return modelsPath
}

// 支持的本地嵌入模型
export const LOCAL_EMBEDDING_MODELS = {
  'nomic-embed-text': 'nomic-ai/nomic-embed-text-v1.5',
  'all-MiniLM-L6': 'Xenova/all-MiniLM-L6-v2',
  'bge-small-zh': 'Xenova/bge-small-zh-v1.5',
  'multilingual-e5-small': 'Xenova/multilingual-e5-small'
} as const

export type LocalEmbeddingModelName = keyof typeof LOCAL_EMBEDDING_MODELS

// 模型下载进度回调
export type ModelProgressCallback = (progress: {
  status: 'downloading' | 'loading' | 'ready' | 'error'
  progress?: number // 0-100
  file?: string
  message?: string
}) => void

let cachedModelName: string | null = null
let isInitializing = false
let initPromise: Promise<void> | null = null
// 全局进度回调（用于在初始化期间更新进度）
let globalProgressCallback: ModelProgressCallback | null = null

/**
 * 设置全局进度回调
 */
export function setProgressCallback(callback: ModelProgressCallback | null): void {
  globalProgressCallback = callback
}

/**
 * 初始化本地嵌入模型
 */
export async function initLocalEmbeddings(
  modelName: LocalEmbeddingModelName = 'nomic-embed-text',
  onProgress?: ModelProgressCallback
): Promise<void> {
  const modelId = LOCAL_EMBEDDING_MODELS[modelName]

  // 合并进度回调：优先使用传入的，否则使用全局的
  const progressCallback = onProgress ?? globalProgressCallback

  // 如果已经加载了相同的模型，直接返回，不再重复发送 ready 消息
  if (cachedModelName === modelId) {
    // progressCallback?.({ status: 'ready', message: '模型已就绪' })
    return
  }

  // 如果正在初始化，等待完成
  if (isInitializing && initPromise) {
    // 更新全局回调，这样进度会发送给最新的监听者
    if (onProgress) {
      globalProgressCallback = onProgress
    }
    return initPromise
  }

  isInitializing = true
  // 保存进度回调供下载过程使用
  if (progressCallback) {
    globalProgressCallback = progressCallback
  }

  initPromise = (async () => {
    try {
      const modelsPath = getModelsPath()
      
      globalProgressCallback?.({ status: 'downloading', message: `正在加载模型 ${modelName}...` })

      await initEmbeddingInWorker(modelId, modelsPath, (payload) => {
        // Handle progress from worker
        const { status, progress, file } = payload
        if (status === 'progress' && progress !== undefined) {
           globalProgressCallback?.({
              status: 'downloading',
              progress: progress,
              file: file,
              message: `下载中: ${file} (${Math.round(progress)}%)`
            })
        } else if (status === 'done') {
           globalProgressCallback?.({
              status: 'loading',
              message: `文件 ${file} 下载完成`
           })
        }
      })

      cachedModelName = modelId
      isInitializing = false
      initPromise = null

      globalProgressCallback?.({ status: 'ready', message: '模型加载完成' })
      console.log(`Local embedding model ${modelName} initialized successfully in worker`)
    } catch (error) {
      isInitializing = false
      initPromise = null
      cachedModelName = null

      const errorMessage = error instanceof Error ? error.message : '未知错误'
      globalProgressCallback?.({ status: 'error', message: `模型加载失败: ${errorMessage}` })
      console.error('Failed to initialize local embedding model in worker:', error)
      throw error
    }
  })()

  return initPromise
}

/**
 * 获取文本的嵌入向量
 */
export async function getLocalEmbedding(
  text: string,
  modelName: LocalEmbeddingModelName = 'nomic-embed-text'
): Promise<number[]> {
  await initLocalEmbeddings(modelName)
  const results = await embedInWorker([text])
  return results[0]
}

/**
 * 批量获取嵌入向量
 */
export async function getLocalEmbeddings(
  texts: string[],
  modelName: LocalEmbeddingModelName = 'nomic-embed-text'
): Promise<number[][]> {
  await initLocalEmbeddings(modelName)
  return embedInWorker(texts)
}

/**
 * 检查模型是否已下载
 */
export function isModelDownloaded(modelName: LocalEmbeddingModelName): boolean {
  const modelId = LOCAL_EMBEDDING_MODELS[modelName]
  const modelsPath = getModelsPath()
  const modelPath = path.join(modelsPath, modelId.replace('/', '--'))
  return fs.existsSync(modelPath)
}

/**
 * 获取已下载的模型列表
 */
export function getDownloadedModels(): LocalEmbeddingModelName[] {
  return (Object.keys(LOCAL_EMBEDDING_MODELS) as LocalEmbeddingModelName[]).filter((name) =>
    isModelDownloaded(name)
  )
}

/**
 * 清理模型缓存
 */
export function clearModelCache(): void {
  cachedModelName = null
  // We might want to tell worker to clear cache or unload model, but currently not implemented in worker
}

/**
 * LangChain 兼容的本地嵌入类
 */
export interface LocalEmbeddingsParams extends EmbeddingsParams {
  modelName?: LocalEmbeddingModelName
  onProgress?: ModelProgressCallback
}

export class LocalEmbeddings extends Embeddings {
  private modelName: LocalEmbeddingModelName
  private onProgress?: ModelProgressCallback
  private tempProgressCallback?: ModelProgressCallback
  private initialized = false

  constructor(params: LocalEmbeddingsParams = {}) {
    super(params)
    this.modelName = params.modelName ?? 'nomic-embed-text'
    this.onProgress = params.onProgress
  }

  /**
   * 设置临时进度回调（用于覆盖默认回调）
   */
  setTempProgressCallback(callback?: ModelProgressCallback): void {
    this.tempProgressCallback = callback
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await initLocalEmbeddings(this.modelName, this.tempProgressCallback ?? this.onProgress)
    this.initialized = true
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    await this.initialize()
    
    // 分批处理以支持进度报告
    const batchSize = 16
    const total = documents.length
    const results: number[][] = []
    
    // 如果文档数量少，直接处理
    if (total <= batchSize) {
      return getLocalEmbeddings(documents, this.modelName)
    }

    // 分批处理
    for (let i = 0; i < total; i += batchSize) {
      const batch = documents.slice(i, i + batchSize)
      const batchResults = await getLocalEmbeddings(batch, this.modelName)
      results.push(...batchResults)
      
      // 报告进度
      const callback = this.tempProgressCallback ?? this.onProgress
      if (callback) {
        const processed = Math.min(i + batchSize, total)
        const percent = Math.round((processed / total) * 100)
        callback({
          status: 'loading',
          progress: percent,
          message: `正在生成向量 (${processed}/${total})`
        })
      }
    }
    
    return results
  }

  async embedQuery(document: string): Promise<number[]> {
    await this.initialize()
    return getLocalEmbedding(document, this.modelName)
  }
}
