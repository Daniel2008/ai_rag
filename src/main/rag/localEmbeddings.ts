/**
 * 本地嵌入模型模块
 * 使用 @huggingface/transformers 实现不依赖 Ollama 的本地嵌入
 */
import { pipeline, env, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'

// 使用 HF-Mirror 镜像站加速下载（国内访问）
// 参考: https://hf-mirror.com/
env.remoteHost = 'https://hf-mirror.com/'

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

// 缓存的 pipeline 实例
let cachedPipeline: FeatureExtractionPipeline | null = null
let cachedModelName: string | null = null
let isInitializing = false
let initPromise: Promise<FeatureExtractionPipeline> | null = null
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
): Promise<FeatureExtractionPipeline> {
  const modelId = LOCAL_EMBEDDING_MODELS[modelName]

  // 合并进度回调：优先使用传入的，否则使用全局的
  const progressCallback = onProgress ?? globalProgressCallback

  // 如果已经加载了相同的模型，直接返回
  if (cachedPipeline && cachedModelName === modelId) {
    progressCallback?.({ status: 'ready', message: '模型已就绪' })
    return cachedPipeline
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
      // 设置缓存目录和模型下载配置
      const modelsPath = getModelsPath()
      env.cacheDir = modelsPath
      env.allowLocalModels = true
      env.allowRemoteModels = true
      // 设置使用 HF-Mirror 镜像站（已在模块顶部通过环境变量配置）

      // 使用全局回调发送进度
      globalProgressCallback?.({ status: 'downloading', message: `正在加载模型 ${modelName}...` })

      // 创建 pipeline，会自动下载模型
      const extractor = await pipeline('feature-extraction', modelId, {
        progress_callback: (progressInfo: { status: string; progress?: number; file?: string }) => {
          if (progressInfo.status === 'progress' && progressInfo.progress !== undefined) {
            globalProgressCallback?.({
              status: 'downloading',
              progress: progressInfo.progress,
              file: progressInfo.file,
              message: `下载中: ${progressInfo.file} (${Math.round(progressInfo.progress)}%)`
            })
          } else if (progressInfo.status === 'done') {
            globalProgressCallback?.({
              status: 'loading',
              message: `文件 ${progressInfo.file} 下载完成`
            })
          }
        }
      })

      cachedPipeline = extractor
      cachedModelName = modelId
      isInitializing = false
      initPromise = null

      globalProgressCallback?.({ status: 'ready', message: '模型加载完成' })
      console.log(`Local embedding model ${modelName} initialized successfully`)

      return extractor
    } catch (error) {
      isInitializing = false
      initPromise = null
      cachedPipeline = null
      cachedModelName = null

      const errorMessage = error instanceof Error ? error.message : '未知错误'
      globalProgressCallback?.({ status: 'error', message: `模型加载失败: ${errorMessage}` })
      console.error('Failed to initialize local embedding model:', error)
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
  const extractor = await initLocalEmbeddings(modelName)

  // 生成嵌入向量
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true
  })

  // 转换为数组
  return Array.from(output.data as Float32Array)
}

/**
 * 批量获取嵌入向量
 */
export async function getLocalEmbeddings(
  texts: string[],
  modelName: LocalEmbeddingModelName = 'nomic-embed-text'
): Promise<number[][]> {
  const extractor = await initLocalEmbeddings(modelName)

  const results: number[][] = []

  // 逐个处理以避免内存问题
  for (const text of texts) {
    const output = await extractor(text, {
      pooling: 'mean',
      normalize: true
    })
    results.push(Array.from(output.data as Float32Array))
  }

  return results
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
  cachedPipeline = null
  cachedModelName = null
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
  private initialized = false

  constructor(params: LocalEmbeddingsParams = {}) {
    super(params)
    this.modelName = params.modelName ?? 'nomic-embed-text'
    this.onProgress = params.onProgress
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await initLocalEmbeddings(this.modelName, this.onProgress)
    this.initialized = true
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    await this.initialize()
    return getLocalEmbeddings(documents, this.modelName)
  }

  async embedQuery(document: string): Promise<number[]> {
    await this.initialize()
    return getLocalEmbedding(document, this.modelName)
  }
}

