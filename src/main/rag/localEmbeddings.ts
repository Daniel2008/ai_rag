/**
 * 本地嵌入模型模块
 * 使用 Worker 线程运行 @huggingface/transformers 实现不依赖 Ollama 的本地嵌入
 */
import { Embeddings, type EmbeddingsParams } from '@langchain/core/embeddings'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import { initEmbeddingInWorker, embedInWorker } from './workerManager'
import { ProgressCallback, ProgressStatus, TaskType, ProgressMessage } from './progressTypes'
import { RAG_CONFIG } from '../utils/config'

// 配置模型缓存路径到应用数据目录
const getModelsPath = (): string => {
  // 兼容非Electron环境
  const userDataPath = app?.getPath ? app.getPath('userData') : process.cwd()
  const modelsPath = path.join(userDataPath, 'models')
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true })
  }
  return modelsPath
}

// 支持的本地嵌入模型
// 推荐使用 multilingual-e5-small 或 bge-m3 用于多语言场景
export const LOCAL_EMBEDDING_MODELS = {
  // 多语言模型（推荐用于中英文混合场景）
  'multilingual-e5-small': 'intfloat/multilingual-e5-small', // 多语言，效果好
  'multilingual-e5-base': 'intfloat/multilingual-e5-base', // 多语言，更大更准
  'bge-m3': 'BAAI/bge-m3', // 多语言，最新最强

  // 中文专用模型
  'bge-small-zh': 'BAAI/bge-small-zh-v1.5', // 中文专用
  'bge-base-zh': 'BAAI/bge-base-zh-v1.5', // 中文专用，更大

  // 英文模型
  'nomic-embed-text': 'nomic-ai/nomic-embed-text-v1.5', // 英文，效果好
  'all-MiniLM-L6': 'Xenova/all-MiniLM-L6-v2', // 英文，轻量

  // 通用多语言（Xenova 量化版，兼容性好）
  'paraphrase-multilingual': 'Xenova/paraphrase-multilingual-MiniLM-L12-v2'
} as const

export type LocalEmbeddingModelName = keyof typeof LOCAL_EMBEDDING_MODELS

// 模型语言支持信息
export const MODEL_LANGUAGE_SUPPORT: Record<
  LocalEmbeddingModelName,
  {
    languages: string[]
    recommended: boolean
    description: string
  }
> = {
  'multilingual-e5-small': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru'],
    recommended: true,
    description: '多语言嵌入模型，支持100+语言，推荐用于中英文混合场景'
  },
  'multilingual-e5-base': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru'],
    recommended: true,
    description: '多语言嵌入模型（大），效果更好但更慢'
  },
  'bge-m3': {
    languages: ['zh', 'en', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'pt', 'ru'],
    recommended: true,
    description: 'BAAI最新多语言模型，支持稀疏+密集混合检索'
  },
  'bge-small-zh': {
    languages: ['zh'],
    recommended: false,
    description: '中文专用嵌入模型，仅支持中文'
  },
  'bge-base-zh': {
    languages: ['zh'],
    recommended: false,
    description: '中文专用嵌入模型（大），仅支持中文'
  },
  'nomic-embed-text': {
    languages: ['en'],
    recommended: false,
    description: '英文嵌入模型，不推荐用于中文'
  },
  'all-MiniLM-L6': {
    languages: ['en'],
    recommended: false,
    description: '轻量英文模型，不推荐用于中文'
  },
  'paraphrase-multilingual': {
    languages: ['zh', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru'],
    recommended: false,
    description: '多语言释义模型，兼容性好'
  }
}

// 模型下载进度回调
export type ModelProgressCallback = ProgressCallback

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
    // 保存当前的进度回调，确保在Worker返回消息时使用正确的回调
    const currentProgressCallback = progressCallback
    let retryCount = 0
    const maxRetries = 2

    // 重试机制：当模型加载失败时，尝试重新下载
    while (retryCount <= maxRetries) {
      try {
        const modelsPath = getModelsPath()

        currentProgressCallback?.({
          status: ProgressStatus.DOWNLOADING,
          progress: 20,
          message: `正在加载模型 ${modelName}...`,
          taskType: TaskType.MODEL_DOWNLOAD
        })

        await initEmbeddingInWorker(modelId, modelsPath, (payload) => {
          // Handle progress from worker
          const payloadObj = payload as Record<string, unknown>
          let progressMessage: ProgressMessage

          // Check if it's already a standard ProgressMessage
          if (typeof payloadObj.status === 'string' && typeof payloadObj.taskType === 'string') {
            progressMessage = payload as ProgressMessage
          } else {
            // Convert old format to standard ProgressMessage
            if (typeof payloadObj.progress === 'number' && typeof payloadObj.file === 'string') {
              // 处理模型文件下载进度
              progressMessage = {
                status: ProgressStatus.DOWNLOADING,
                progress: payloadObj.progress,
                fileName: payloadObj.file,
                message: `下载中: ${payloadObj.file} (${Math.round(payloadObj.progress)}%)`,
                taskType: TaskType.MODEL_DOWNLOAD
              }
            } else if (
              payloadObj.step === 'downloading' &&
              typeof payloadObj.message === 'string'
            ) {
              // 处理镜像切换等进度消息
              progressMessage = {
                status: ProgressStatus.DOWNLOADING,
                message: payloadObj.message,
                taskType: TaskType.MODEL_DOWNLOAD,
                progress: (payloadObj.progress as number) || undefined
              }
            } else {
              // Default case: handle unexpected payloads
              progressMessage = {
                status: ProgressStatus.DOWNLOADING,
                message: (payloadObj.message as string) || '处理中...',
                taskType: TaskType.MODEL_DOWNLOAD,
                progress: (payloadObj.progress as number) || undefined
              }
            }
          }

          // Forward the unified progress message using the current callback
          currentProgressCallback?.(progressMessage)
        })

        cachedModelName = modelId
        isInitializing = false
        initPromise = null

        // 使用当前回调发送完成消息
        currentProgressCallback?.({
          status: ProgressStatus.READY,
          progress: 100,
          message: '模型加载完成',
          taskType: TaskType.MODEL_DOWNLOAD
        })
        console.log(`Local embedding model ${modelName} initialized successfully in worker`)
        return
      } catch (error) {
        retryCount++
        const errorMessage = error instanceof Error ? error.message : '未知错误'

        // 检查是否是Protobuf解析错误，如果是，且重试次数未用尽，则尝试重新初始化
        const isProtobufError = errorMessage.includes('Protobuf parsing failed')

        if (isProtobufError && retryCount <= maxRetries) {
          console.warn(
            `模型文件可能已损坏 (${errorMessage}), 正在尝试第 ${retryCount} 次重新下载...`
          )

          // 尝试清理损坏的模型目录
          try {
            const modelsPath = getModelsPath()
            // 常见的缓存目录结构处理
            const modelDirName = modelId.replace('/', path.sep)
            const modelFullPath = path.join(modelsPath, modelDirName)
            const modelLegacyPath = path.join(modelsPath, modelId.replace('/', '--'))

            if (fs.existsSync(modelFullPath)) {
              console.log(`正在清理损坏的模型目录: ${modelFullPath}`)
              fs.rmSync(modelFullPath, { recursive: true, force: true })
            }
            if (fs.existsSync(modelLegacyPath)) {
              console.log(`正在清理旧版格式的模型目录: ${modelLegacyPath}`)
              fs.rmSync(modelLegacyPath, { recursive: true, force: true })
            }
          } catch (cleanupError) {
            console.error('清理损坏模型目录失败:', cleanupError)
          }

          currentProgressCallback?.({
            status: ProgressStatus.DOWNLOADING,
            message: `模型文件可能已损坏，正在尝试重新下载 (${retryCount}/${maxRetries})...`,
            taskType: TaskType.MODEL_DOWNLOAD
          })

          // 清理缓存，强制重新下载
          cachedModelName = null

          // 等待1秒后重试
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } else {
          // 非Protobuf错误或重试次数已用尽，报告错误
          isInitializing = false
          initPromise = null
          cachedModelName = null

          currentProgressCallback?.({
            status: ProgressStatus.ERROR,
            message: `模型加载失败: ${errorMessage}`,
            taskType: TaskType.MODEL_DOWNLOAD
          })
          console.error('Failed to initialize local embedding model in worker:', error)
          throw error
        }
      }
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

    // 优化：增大批处理大小以提升吞吐量
    // Worker 内部会进一步分批（每 8 个文本一批）给模型处理
    const batchSize = RAG_CONFIG.BATCH.EMBEDDING_BATCH_SIZE
    const total = documents.length
    const results: number[][] = []

    // 如果文档数量少，直接处理
    if (total <= batchSize) {
      return getLocalEmbeddings(documents, this.modelName)
    }

    // 报告开始向量化
    const callback = this.tempProgressCallback ?? this.onProgress
    callback?.({
      status: ProgressStatus.PROCESSING,
      progress: 0,
      message: `开始生成向量 (0/${total})`,
      taskType: TaskType.EMBEDDING_GENERATION
    })

    // 减少进度更新频率
    const progressUpdateInterval = Math.max(
      1,
      Math.floor(total / RAG_CONFIG.BATCH.PROGRESS_UPDATE_INTERVAL)
    )
    let lastProgressUpdate = 0

    // 分批处理
    for (let i = 0; i < total; i += batchSize) {
      const batch = documents.slice(i, i + batchSize)
      const batchResults = await getLocalEmbeddings(batch, this.modelName)
      results.push(...batchResults)

      // 控制进度更新频率
      const processed = Math.min(i + batchSize, total)
      if (
        callback &&
        (processed - lastProgressUpdate >= progressUpdateInterval || processed === total)
      ) {
        lastProgressUpdate = processed
        const percent = Math.round((processed / total) * 100)
        callback({
          status: ProgressStatus.PROCESSING,
          progress: percent,
          message: `正在生成向量 (${processed}/${total})`,
          taskType: TaskType.EMBEDDING_GENERATION
        })
      }
    }

    // 报告完成
    callback?.({
      status: ProgressStatus.COMPLETED,
      progress: 100,
      message: `向量生成完成 (${total}/${total})`,
      taskType: TaskType.EMBEDDING_GENERATION
    })

    return results
  }

  async embedQuery(document: string): Promise<number[]> {
    await this.initialize()
    return getLocalEmbedding(document, this.modelName)
  }
}
