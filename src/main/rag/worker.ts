import { parentPort } from 'worker_threads'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'

import { loadAndSplitFile } from './loader'
import { ProgressStatus, TaskType } from './progressTypes'

// 重新导出类型以保持兼容性
export { ProgressStatus, TaskType }

/**
 * 标准进度消息接口
 */
export interface ProgressMessage {
  /** 任务类型 */
  taskType: TaskType
  /** 进度状态 */
  status: ProgressStatus
  /** 当前进度百分比 (0-100) */
  progress?: number
  /** 当前处理的文件名 */
  fileName?: string
  /** 当前处理的步骤名称 */
  step?: string
  /** 进度描述信息 */
  message: string
  /** 预计剩余时间（毫秒） */
  eta?: number
  /** 已处理的数量 */
  processedCount?: number
  /** 总数量 */
  totalCount?: number
  /** 当前索引 */
  currentIndex?: number
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: ProgressMessage) => void

// Lazy load variables
let pipeline: any
let env: any

// Helper to ensure transformers is loaded and configured
async function ensureTransformers() {
  if (pipeline && env) return

  console.log('[WORKER] Lazy loading @huggingface/transformers...')
  const transformers = await import('@huggingface/transformers')
  pipeline = transformers.pipeline
  env = transformers.env

  // Configure transformers with fallback mirrors
  env.allowLocalModels = true
  env.allowRemoteModels = true
  env.useBrowserCache = false // Disable caching to avoid issues with partial downloads or failed requests
  // Set backend timeout settings for model downloads and inference
  env.backends = {
    onnx: {
      // Set timeout for model downloads and operations (in milliseconds)
      executionMode: 'SEQUENTIAL'
      // Note: For downloading, Transformers.js uses fetch which has its own timeout mechanism
      // The actual download timeout is handled by the retry logic in our code
    }
  }
}

const HF_MIRROR = 'https://hf-mirror.com'

// Patch global fetch to add timeout, logging and retry mechanism
const originalFetch = global.fetch
global.fetch = async (url, init) => {
  const urlStr = url.toString()
  const MAX_RETRIES = 3
  const TIMEOUT = 60000 // 60 seconds

  // Helper to sleep
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  let lastError: Error | null = null

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const controller = new AbortController()
    const id = setTimeout(() => controller.abort(), TIMEOUT)

    try {
      if (attempt > 0) {
        console.log(`[FETCH] Retrying ${urlStr} (attempt ${attempt + 1}/${MAX_RETRIES})`)
        await sleep(1000 * attempt) // Exponential backoff-ish
      }

      const response = await originalFetch(url, {
        ...init,
        signal: init?.signal || controller.signal
      })
      clearTimeout(id)

      // Treat server errors as retryable
      if (!response.ok && response.status >= 500) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      return response
    } catch (error) {
      clearTimeout(id)
      lastError = error as Error

      const isAbort = lastError.name === 'AbortError'
      if (isAbort) {
        console.error(`[FETCH] Timeout after ${TIMEOUT}ms for ${urlStr}`)
      } else {
        console.error(`[FETCH] Error for ${urlStr} (attempt ${attempt + 1}):`, lastError.message)
        // Check for specific error codes like ETIMEDOUT, ECONNRESET, etc.
        const cause = (lastError as any).cause
        if (cause) {
          console.error(`[FETCH] Cause:`, cause)
        }
      }

      // If it's the last attempt, throw the error
      if (attempt === MAX_RETRIES - 1) {
        throw lastError
      }
    }
  }
  throw lastError || new Error('Fetch failed')
}

// Define types for better type safety
// Use the library's ProgressCallback type directly

// Use the library's FeatureExtractionPipeline type directly
let embeddingPipeline: FeatureExtractionPipeline | null = null
let rerankPipeline: any | null = null

// Helper function to map short model names to full Hugging Face model IDs
function mapModelName(modelName: string): string {
  const modelMap: Record<string, string> = {
    'bert-base': 'bert-base-uncased',
    'bert-large': 'bert-large-uncased',
    'sentence-transformers': 'sentence-transformers/all-MiniLM-L6-v2',
    'nomic-bert': 'nomic-ai/nomic-bert-2048',
    'bge-reranker-base': 'Xenova/bge-reranker-base',
    'bge-reranker-v2-m3': 'Xenova/bge-reranker-v2-m3'
    // Add more mappings as needed
  }
  return modelMap[modelName] || modelName
}

if (!parentPort) {
  throw new Error('This file must be run as a worker')
}

parentPort.on('message', async (task) => {
  const { id, type, payload } = task

  try {
    if (type === 'initEmbedding' || type === 'initReranker') {
      await ensureTransformers()
      const { modelName, cacheDir } = payload
      if (cacheDir) {
        env.cacheDir = cacheDir
      }

      // Map short name to full model ID if needed
      const fullModelName = mapModelName(modelName)

      // Define mirror URL
      const mirrorUrl = HF_MIRROR

      // Configure environment variables for transformers.js
      if (process && process.env) {
        process.env.HF_ENDPOINT = mirrorUrl
      }

      // Check if the mirror URL ends with a slash, if not, add it
      const formattedMirrorUrl = mirrorUrl.endsWith('/') ? mirrorUrl : mirrorUrl + '/'

      // Log the mirror information
      console.log('[MIRROR] Using mirror:', formattedMirrorUrl)

      // Set the mirror URL directly to ensure proper configuration
      // We need to set both remoteHost and remotePathTemplate correctly
      env.remoteHost = formattedMirrorUrl
      // Ensure remotePathTemplate is properly set (default: '{model}/resolve/{revision}/')
      env.remotePathTemplate = '{model}/resolve/{revision}/'

      // Log the current configuration to verify
      console.log('[MIRROR] Current remoteHost:', env.remoteHost)
      console.log('[MIRROR] Current remotePathTemplate:', env.remotePathTemplate)

      // Delete any conflicting properties
      if ('remoteHostname' in env) {
        delete env.remoteHostname
      }

      if ('baseUrl' in env) {
        delete env.baseUrl
      }

      // Set the cache directory to a user-accessible location
      env.cacheDir = cacheDir || env.cacheDir

      // Allow loading models from both local and remote sources
      env.allowLocalModels = true
      env.allowRemoteModels = true
      console.log(`[MIRROR] Current cacheDir: ${env.cacheDir}`)
      let progressCheckInterval: NodeJS.Timeout | undefined
      try {
        const startTime = Date.now()
        progressCheckInterval = setInterval(() => {
          const elapsedTime = Date.now() - startTime
          console.log(
            `Progress check: ${elapsedTime}ms since start, last progress: ${lastReportedGlobalProgress}`
          )
          // 只有当进度小于100%时才检查和发送更新
          if (lastReportedGlobalProgress < 100 && elapsedTime > 30000) {
            parentPort?.postMessage({
              id,
              type: 'progress',
              payload: {
                taskType: TaskType.MODEL_DOWNLOAD,
                status: ProgressStatus.DOWNLOADING,
                message: `Still downloading model from ${mirrorUrl} (${Math.round(elapsedTime / 1000)}s)`,
                progress: Math.min(99, lastReportedGlobalProgress + 1), // 最多显示99%，避免提前显示完成
                mirror: mirrorUrl,
                debugInfo: { lastProgress: lastReportedGlobalProgress, elapsedTime }
              }
            })
          }
        }, 10000)

        if (process && process.env) {
          process.env.TRANSFORMERS_LOG_LEVEL = 'ERROR'
        }

        // ====== 重构的进度跟踪系统 ======

        // 文件下载状态接口
        interface FileDownloadState {
          loaded: number // 已下载字节数
          total: number // 文件总字节数
          completed: boolean // 是否下载完成
        }

        // 进度消息接口，与前端保持一致
        interface ProgressMessage {
          id: string
          type: 'progress'
          payload: {
            taskType: string
            status: ProgressStatus
            message: string
            progress: number // 0-100的整数
            stage: string // 与前端ProcessProgress.stage字段对应
            file?: string // 当前正在下载的文件
            fileProgress?: number // 0-1的小数
            error?: string // 错误信息
          }
        }

        const fileStates = new Map<string, FileDownloadState>()
        let isModelReady = false // 模型是否可使用
        let allFilesDownloaded = false // 所有文件是否下载完成
        let lastReportedGlobalProgress = 0 // 上次报告的进度（确保只增不减）
        let progressUpdateThrottle = 0 // 进度更新节流控制

        // 配置参数
        const THROTTLE_INTERVAL = 100 // 进度更新节流间隔（毫秒）
        const MIN_PROGRESS_CHANGE = 1 // 最小进度变化（百分比）

        // 计算整体进度的函数
        const calculateProgress = (): number => {
          if (fileStates.size === 0) return 0

          let totalLoaded = 0
          let totalSize = 0
          let completedFiles = 0

          for (const [, state] of fileStates.entries()) {
            totalLoaded += state.loaded
            totalSize += state.total
            if (state.completed) completedFiles++
          }

          // 计算完成百分比
          let progress = 0

          if (totalSize > 0) {
            // 如果有总大小信息，基于已下载大小计算进度
            progress = (totalLoaded / totalSize) * 100
          } else {
            // 如果没有总大小信息，基于已完成文件数量计算进度
            progress = (completedFiles / fileStates.size) * 100
          }

          // 更新全局状态
          allFilesDownloaded = completedFiles === fileStates.size && fileStates.size > 0

          return Math.round(progress)
        }

        // 发送进度更新的函数
        const sendProgressUpdate = (
          status: ProgressStatus,
          message: string,
          file?: string,
          fileProgress?: number
        ) => {
          // 节流控制，避免闪烁
          const now = Date.now()

          // 计算当前进度
          const currentProgress = calculateProgress()

          // 确保进度只增不减
          const finalProgress = Math.max(currentProgress, lastReportedGlobalProgress)

          // 检查是否需要更新进度
          const progressChanged = finalProgress - lastReportedGlobalProgress >= MIN_PROGRESS_CHANGE
          const isCompleted = status === ProgressStatus.COMPLETED
          const isError = status === ProgressStatus.ERROR

          // 如果进度变化不大且不是完成或错误状态，并且在节流间隔内，则不更新
          if (!progressChanged && !isCompleted && !isError) {
            if (now - progressUpdateThrottle < THROTTLE_INTERVAL) {
              return
            }
          }

          // 更新最后报告的进度和时间
          lastReportedGlobalProgress = finalProgress
          progressUpdateThrottle = now

          // 构建进度消息，确保与前端ProcessProgress接口完全一致
          const progressMessage: ProgressMessage = {
            id,
            type: 'progress',
            payload: {
              taskType: TaskType.MODEL_DOWNLOAD,
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
              fileProgress:
                fileProgress !== undefined ? Math.max(0, Math.min(1, fileProgress)) : undefined
            }
          }

          // 发送进度消息
          parentPort?.postMessage(progressMessage)
        }

        // 主进度回调函数
        const customProgressCallback = (progress: any) => {
          const { status, file, loaded, total } = progress

          // 初始化文件状态
          if (file && !fileStates.has(file)) {
            fileStates.set(file, {
              loaded: 0,
              total: total || 0,
              completed: false
            })
          }

          // 更新文件状态
          if (file && fileStates.has(file)) {
            const state = fileStates.get(file)! as FileDownloadState

            switch (status) {
              case 'initiate':
                // 开始下载新文件
                state.total = total || state.total
                sendProgressUpdate(ProgressStatus.DOWNLOADING, `开始下载: ${file}`, file)
                break

              case 'download':
              case 'progress': {
                // 更新下载进度
                state.loaded = loaded || state.loaded
                state.total = total || state.total

                // 计算当前文件进度
                const currentFileProgress = state.total > 0 ? state.loaded / state.total : 0

                // 构建消息，显示文件名称、进度和大小
                const loadedMB = (state.loaded / (1024 * 1024)).toFixed(2)
                const totalMB = state.total > 0 ? (state.total / (1024 * 1024)).toFixed(2) : '未知'
                const fileProgressPercent = (currentFileProgress * 100).toFixed(1)

                const message = `下载中: ${file} (${fileProgressPercent}%, ${loadedMB}MB / ${totalMB}MB)`

                sendProgressUpdate(ProgressStatus.DOWNLOADING, message, file, currentFileProgress)
                break
              }

              case 'done': {
                // 文件下载完成
                state.loaded = total || loaded || state.loaded
                state.total = total || state.total
                state.completed = true

                // 更新全局状态
                const completedFiles = Array.from(fileStates.values()).filter(
                  (s) => s.completed
                ).length
                allFilesDownloaded = completedFiles === fileStates.size && fileStates.size > 0

                sendProgressUpdate(ProgressStatus.DOWNLOADING, `文件下载完成: ${file}`, file, 1)

                // 如果所有文件都下载完成且模型已就绪，发送最终进度
                if (allFilesDownloaded && isModelReady) {
                  sendProgressUpdate(ProgressStatus.COMPLETED, `所有模型文件下载完成，模型已可使用`)
                } else if (allFilesDownloaded) {
                  // 所有文件下载完成但模型尚未就绪
                  sendProgressUpdate(ProgressStatus.PROCESSING, `所有文件下载完成，模型正在初始化`)
                }
                break
              }
            }
          }

          // 特殊处理 ready 事件
          if (status === 'ready') {
            console.log('[DEBUG] Model ready event received')
            isModelReady = true

            // 检查是否所有文件都已下载完成
            const completedFiles = Array.from(fileStates.values()).filter((s) => s.completed).length
            const totalFiles = fileStates.size

            console.log('[DEBUG] Ready status - Files:', totalFiles, 'Completed:', completedFiles)

            // 如果没有跟踪到文件，说明模型可能是从缓存加载的
            if (totalFiles === 0) {
              sendProgressUpdate(ProgressStatus.COMPLETED, `模型已从缓存加载并可使用`)
              return
            }

            // 更新全局状态
            allFilesDownloaded = completedFiles === totalFiles

            // 只有当所有文件都下载完成时才标记为完全就绪
            if (allFilesDownloaded) {
              sendProgressUpdate(ProgressStatus.COMPLETED, `模型已完全就绪并可使用`)
            } else {
              // 模型可用但还有文件在后台下载
              const message = `模型已可用，${completedFiles}/${totalFiles} 个文件正在后台下载`
              sendProgressUpdate(ProgressStatus.PROCESSING, message)
            }
          }
        }

        // 下载并初始化模型
        try {
          if (type === 'initEmbedding') {
            embeddingPipeline = (await pipeline('feature-extraction', fullModelName, {
              progress_callback: customProgressCallback,
              timeout: 300000 // 5分钟超时
            })) as unknown as FeatureExtractionPipeline
          } else {
            rerankPipeline = await pipeline('text-classification', fullModelName, {
              progress_callback: customProgressCallback,
              timeout: 300000
            })
          }
        } catch (error) {
          console.error('[ERROR] Pipeline initialization failed:', error)
          throw error
        } finally {
          clearInterval(progressCheckInterval)
        }

        // 模型初始化完成，但可能还有文件在后台下载
        console.log('[DEBUG] Pipeline function returned - checking file states:')
        console.log('[DEBUG] Total files tracked:', fileStates.size)
        console.log(
          '[DEBUG] Completed files:',
          Array.from(fileStates.values()).filter((s) => s.completed).length
        )

        // 等待一小段时间让文件下载完成
        await new Promise((resolve) => setTimeout(resolve, 1000))

        // 最终检查文件状态
        const finalCompletedFiles = Array.from(fileStates.values()).filter(
          (s) => s.completed
        ).length
        const finalTotalFiles = fileStates.size

        console.log(
          '[DEBUG] Final file status - Completed:',
          finalCompletedFiles,
          'Total:',
          finalTotalFiles
        )

        // 如果还有文件未下载完成，继续监控
        if (finalCompletedFiles < finalTotalFiles && finalTotalFiles > 0) {
          console.log('[DEBUG] Model initialized but files still downloading')

          // 设置一个监控定时器，检查文件下载状态
          const fileCheckInterval = setInterval(() => {
            const completed = Array.from(fileStates.values()).filter((s) => s.completed).length
            const total = fileStates.size

            console.log('[DEBUG] File monitor - Completed:', completed, 'Total:', total)

            if (completed === total) {
              clearInterval(fileCheckInterval)
              sendProgressUpdate(ProgressStatus.COMPLETED, `所有模型文件已下载完成`)
            } else if (completed > finalCompletedFiles) {
              // 有新文件完成，更新进度
              // 进度计算已在sendProgressUpdate中处理
              sendProgressUpdate(ProgressStatus.DOWNLOADING, `${completed}/${total} 文件已下载`)
            }
          }, 2000)

          // 最大监控时间：30秒
          setTimeout(() => clearInterval(fileCheckInterval), 30000)
        } else if (finalTotalFiles === 0) {
          // 没有文件被跟踪，可能模型已经在缓存中
          sendProgressUpdate(ProgressStatus.COMPLETED, `模型已从缓存加载完成`)
        } else {
          // 所有文件都已下载完成
          sendProgressUpdate(ProgressStatus.COMPLETED, `模型初始化完成并可使用`)
        }

        parentPort?.postMessage({ id, success: true })
      } catch (error) {
        if (progressCheckInterval) clearInterval(progressCheckInterval)
        parentPort?.postMessage({
          id,
          type: 'progress',
          payload: {
            taskType: TaskType.MODEL_DOWNLOAD,
            status: ProgressStatus.ERROR,
            message: `Failed to download model from ${mirrorUrl}: ${(error as Error).message}`,
            error: (error as Error).message
          }
        })
        throw error
      }
    } else if (type === 'embed') {
      if (!embeddingPipeline) throw new Error('Embedding pipeline not initialized')
      const { texts } = payload
      const totalTexts = Array.isArray(texts) ? texts.length : 1

      // Send embedding start progress
      parentPort?.postMessage({
        id,
        type: 'progress',
        payload: {
          taskType: TaskType.EMBEDDING_GENERATION,
          status: ProgressStatus.PROCESSING,
          message: `开始向量化，共 ${totalTexts} 个文本`,
          progress: 0,
          processedCount: 0,
          totalCount: totalTexts
        }
      })

      try {
        // 使用模型原生批处理能力进行优化
        // 批处理大小：根据文本长度动态调整，避免内存溢出
        const BATCH_SIZE = 8 // 每批处理 8 个文本（模型级别的批处理）
        const PROGRESS_UPDATE_INTERVAL = Math.max(1, Math.floor(totalTexts / 20)) // 最多更新 20 次进度

        const allTexts = Array.isArray(texts) ? texts : [texts]
        const embeddings: number[][] = []

        for (let batchStart = 0; batchStart < allTexts.length; batchStart += BATCH_SIZE) {
          const batchEnd = Math.min(batchStart + BATCH_SIZE, allTexts.length)
          const batch = allTexts.slice(batchStart, batchEnd)

          // 批量处理：一次性向模型发送多个文本
          let batchOutput
          for (let attempt = 0; attempt < 3; attempt++) {
            try {
              // 使用模型的批处理能力
              batchOutput = await embeddingPipeline(batch, { pooling: 'mean', normalize: true })
              break
            } catch (error) {
              if (attempt === 2) throw error
              await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)))
            }
          }

          if (batchOutput) {
            // 获取批量结果
            const batchEmbeddings = batchOutput.tolist()
            // 如果是单个文本，tolist() 返回的是 [[...]]，需要处理
            if (
              batch.length === 1 &&
              batchEmbeddings.length === 1 &&
              Array.isArray(batchEmbeddings[0])
            ) {
              embeddings.push(batchEmbeddings[0])
            } else {
              embeddings.push(...batchEmbeddings)
            }
          }

          // 控制进度更新频率
          const processed = batchEnd
          if (processed % PROGRESS_UPDATE_INTERVAL === 0 || processed === allTexts.length) {
            const progress = Math.round((processed / allTexts.length) * 100)
            parentPort?.postMessage({
              id,
              type: 'progress',
              payload: {
                taskType: TaskType.EMBEDDING_GENERATION,
                status: ProgressStatus.PROCESSING,
                message: `向量化进度 ${processed}/${allTexts.length}`,
                progress,
                processedCount: processed,
                totalCount: allTexts.length
              }
            })
          }
        }

        // Send embedding completion progress
        parentPort?.postMessage({
          id,
          type: 'progress',
          payload: {
            taskType: TaskType.EMBEDDING_GENERATION,
            status: ProgressStatus.COMPLETED,
            message: `向量化完成`,
            progress: 100,
            processedCount: totalTexts,
            totalCount: totalTexts
          }
        })

        parentPort?.postMessage({ id, success: true, result: embeddings })
      } catch (error) {
        throw new Error(`Failed to generate embeddings: ${(error as Error).message}`)
      }
    } else if (type === 'rerank') {
      if (!rerankPipeline) throw new Error('Rerank pipeline not initialized')
      const { query, documents } = payload
      const totalDocs = documents.length

      try {
        const scores: number[] = []
        // BGE-Reranker uses a cross-encoder approach
        // We need to score pairs of (query, document)
        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i]
          // Standard cross-encoder input format: [query, passage]
          const result = await rerankPipeline(query, {
            top_k: 1,
            text_pair: doc
          })

          // transformers.js returns scores in a specific format for classification
          // Usually [{label: 'LABEL_0', score: 0.123}]
          // For rerankers, we just want the score
          scores.push(result[0].score)

          // Update progress
          if ((i + 1) % 5 === 0 || i === totalDocs - 1) {
            parentPort?.postMessage({
              id,
              type: 'progress',
              payload: {
                taskType: 'reranking',
                status: ProgressStatus.PROCESSING,
                message: `正在重排序: ${i + 1}/${totalDocs}`,
                progress: Math.round(((i + 1) / totalDocs) * 100)
              }
            })
          }
        }

        parentPort?.postMessage({ id, success: true, result: scores })
      } catch (error) {
        throw new Error(`Failed to rerank: ${(error as Error).message}`)
      }
    } else if (type === 'loadAndSplit') {
      const { filePath } = payload
      const docs = await loadAndSplitFile(filePath, (progress) => {
        parentPort?.postMessage({
          id,
          type: 'progress',
          payload: progress
        })
      })
      // Serialize docs to plain objects
      const result = docs.map((d) => ({
        pageContent: d.pageContent,
        metadata: d.metadata
      }))
      parentPort?.postMessage({ id, success: true, result })
    } else {
      throw new Error(`Unknown task type: ${type}`)
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    // 使用类型守卫检查Error对象是否有cause属性
    const hasCause = (e: Error): e is Error & { cause: unknown } => 'cause' in e
    const detailedError = {
      type: error instanceof Error ? error.constructor.name : 'UnknownError',
      message: errorMsg,
      stack: error instanceof Error ? error.stack : undefined,
      cause: error instanceof Error && hasCause(error) ? error.cause : undefined
    }

    console.error(`Worker error [${type}]:`, detailedError)
    parentPort?.postMessage({
      id,
      success: false,
      error: errorMsg,
      detailedError
    })
  }
})
