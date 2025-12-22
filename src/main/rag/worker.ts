import { parentPort } from 'worker_threads'
import type { FeatureExtractionPipeline } from '@huggingface/transformers'
import path from 'path'

// Intercept console logs and send to main process
const originalConsoleLog = console.log
const originalConsoleError = console.error
const originalConsoleWarn = console.warn

console.log = (...args) => {
  originalConsoleLog(...args)
  parentPort?.postMessage({
    type: 'log',
    payload: { level: 'info', args }
  })
}

console.error = (...args) => {
  originalConsoleError(...args)
  parentPort?.postMessage({
    type: 'log',
    payload: { level: 'error', args }
  })
}

console.warn = (...args) => {
  originalConsoleWarn(...args)
  parentPort?.postMessage({
    type: 'log',
    payload: { level: 'warn', args }
  })
}

// Force HF Mirror for all operations
process.env.HF_ENDPOINT = 'https://hf-mirror.com'

import { loadAndSplitFile } from './loader'
import { ProgressStatus, TaskType } from './progressTypes'
import { ProgressManager, type ProgressMessage } from './progressManager'
import { downloadModelFiles } from './modelDownloader'

// 重新导出类型以保持兼容性
export { ProgressStatus, TaskType }
export type { ProgressMessage }

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: ProgressMessage) => void

type TransformersModule = typeof import('@huggingface/transformers')

// Lazy load variables
let pipeline: TransformersModule['pipeline'] | undefined
let env: TransformersModule['env'] | undefined

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
      // executionMode: 'SEQUENTIAL', // This is not a valid top-level option for env.backends.onnx in recent versions
      // Note: For downloading, Transformers.js uses fetch which has its own timeout mechanism
      // The actual download timeout is handled by the retry logic in our code
      // Attempt to prevent deadlocks by configuring session options if possible.
      // However, env.backends.onnx usually takes `wasm` or other backend specific configs.
      // For node.js environment, it uses onnxruntime-node.
    }
  }

  // Disable parallel downloads
  ;(env as unknown as { parallelDownloads?: number }).parallelDownloads = 1

  // Set number of threads to 1 to avoid deadlocks in some environments
  // env.backends.onnx.numThreads = 1; // This might not be exposed directly on env.backends.onnx
  // Instead, we can try to set it via session_options when loading the pipeline, but pipeline API doesn't easily expose session options.

  // Try to set global ONNX options if available in env
  // (env as any).onnx = { ...(env as any).onnx, numThreads: 1 };
}

const HF_MIRROR = 'https://hf-mirror.com'

// Use the library's FeatureExtractionPipeline type directly
let embeddingPipeline: FeatureExtractionPipeline | null = null
type RerankPipeline = (
  text: string,
  options: { top_k?: number; text_pair: string }
) => Promise<Array<{ score: number }>>
let rerankPipeline: RerankPipeline | null = null

// Helper function to map short model names to full Hugging Face model IDs
function mapModelName(modelName: string): string {
  const modelMap: Record<string, string> = {
    'bert-base': 'Xenova/bert-base-uncased',
    'bert-large': 'Xenova/bert-large-uncased',
    'sentence-transformers': 'Xenova/all-MiniLM-L6-v2',
    'nomic-bert': 'nomic-ai/nomic-bert-2048',
    'bge-reranker-base': 'Xenova/bge-reranker-base',
    'bge-reranker-v2-m3': 'Xenova/bge-reranker-v2-m3',
    'intfloat/multilingual-e5-small': 'Xenova/multilingual-e5-small',
    'intfloat/multilingual-e5-large': 'Xenova/multilingual-e5-large',
    'intfloat/multilingual-e5-base': 'Xenova/multilingual-e5-base'
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
      if (!env || !pipeline) {
        throw new Error('Transformers not initialized')
      }
      const envRef = env
      const pipelineFn = pipeline
      const { modelName, cacheDir, offlineFirst } = payload as {
        modelName: string
        cacheDir?: string
        offlineFirst?: boolean
      }
      if (cacheDir) {
        envRef.cacheDir = cacheDir
        envRef.localModelPath = cacheDir
      }

      // Map short name to full model ID if needed
      const fullModelName = mapModelName(modelName)

      // Allow loading models from both local and remote sources
      envRef.allowLocalModels = true
      envRef.allowRemoteModels = !offlineFirst
      envRef.cacheDir = cacheDir || envRef.cacheDir
      envRef.localModelPath = cacheDir || envRef.localModelPath

      const downloadTaskType =
        type === 'initReranker' ? TaskType.RERANKER_DOWNLOAD : TaskType.MODEL_DOWNLOAD

      const progressManager = new ProgressManager(id, downloadTaskType, parentPort)

      let progressCheckInterval: NodeJS.Timeout | undefined
      try {
        const startTime = Date.now()
        progressCheckInterval = setInterval(() => {
          const elapsedTime = Date.now() - startTime
          const lastProgress = progressManager.getLastReportedProgress()

          console.log(
            `Progress check: ${elapsedTime}ms since start, last progress: ${lastProgress}`
          )
          // 只有当进度小于100%时才检查和发送更新
          if (lastProgress < 100 && elapsedTime > 30000) {
            parentPort?.postMessage({
              id,
              type: 'progress',
              payload: {
                taskType: TaskType.MODEL_DOWNLOAD,
                status: ProgressStatus.DOWNLOADING,
                message: `Still downloading model via Hub (${Math.round(elapsedTime / 1000)}s)`,
                progress: Math.min(99, lastProgress + 1), // 最多显示99%，避免提前显示完成
                mirror: HF_MIRROR,
                debugInfo: { lastProgress, elapsedTime }
              }
            })
          }
        }, 10000)

        if (process && process.env) {
          process.env.TRANSFORMERS_LOG_LEVEL = 'ERROR'
        }

        // 下载并初始化模型
        try {
          const timeoutMs = 180000 // 3 minutes

          const runPipelineInit = async (localFilesOnly: boolean) => {
            // Use targetDir if we are sure it exists and we want to load from it
            // This ensures we load from the flattened directory where we downloaded the files
            const modelPath = targetDir

            // Check for available model file to determine dtype
            let dtype = 'fp32' // default
            try {
              const fs = await import('fs')

              // Helper to find file recursively
              const findFile = async (dir: string, pattern: RegExp): Promise<boolean> => {
                try {
                  const entries = await fs.promises.readdir(dir, { withFileTypes: true })
                  for (const entry of entries) {
                    const fullPath = path.join(dir, entry.name)
                    if (entry.isDirectory()) {
                      if (await findFile(fullPath, pattern)) return true
                    } else if (pattern.test(entry.name)) {
                      return true
                    }
                  }
                } catch (e) {
                  console.warn('[WORKER] Failed to runPipelineInit model files:', e)
                }
                return false
              }

              // Check for quantized models
              // Note: transformers.js expects the model file to be named specific ways or specified via config.
              // But for ONNX runtime, we just need to tell it which file to load via dtype/quantized options.

              // If model_quantized.onnx exists (either in root or onnx/ subdir)
              if (await findFile(modelPath, /^model_quantized\.onnx$/)) {
                dtype = 'q8'
              } else if (await findFile(modelPath, /^model_int8\.onnx$/)) {
                dtype = 'int8'
              } else if (await findFile(modelPath, /^model\.onnx$/)) {
                dtype = 'fp32'
              }

              console.log(
                `[WORKER] Detected model files in ${modelPath}, using dtype: ${dtype} (auto-detection enabled)`
              )
            } catch (e) {
              console.warn('[WORKER] Failed to detect model files:', e)
            }

            // NOTE: transformers.js automatic model file selection relies on specific naming or config.
            // If we only have 'model_quantized.onnx', we might need to tell it.
            // Actually, if we pass the directory path, it should find the ONNX file.
            // But if 'model.onnx' is missing and it expects it, we have an issue.
            // By default transformers.js looks for 'model.onnx'.
            // If we have 'model_quantized.onnx', we should specify { dtype: 'q8' } or similar options if available,
            // or rely on it finding the quantized file.
            // The error says "dtype not specified... Using default dtype (fp32)... file was not found locally at .../model.onnx"
            // This means it defaulted to looking for 'model.onnx'.

            // Let's try to pass the correct options.
            const pipelineOptions: {
              progress_callback: (progress: Record<string, unknown>) => void
              local_files_only: boolean
              dtype?: 'q8' | 'int8' | 'fp32'
            } = {
              progress_callback: progressManager.customProgressCallback,
              local_files_only: localFilesOnly
            }

            // If we downloaded a quantized model, we must hint the pipeline to look for it
            // usually via { dtype: 'q8' } or { quantized: true } depending on version.
            // In @huggingface/transformers v3, using dtype: 'q8' should make it look for model_quantized.onnx
            // However, the error suggests it still defaults to 'model.onnx' if not found.
            // Let's be more explicit with model file name if possible, OR just use the correct dtype mapping.

            // For older versions or specific setups, dtype: 'q8' maps to 'model_quantized.onnx'.
            // But if the file is in a subdirectory (onnx/model_quantized.onnx), transformers.js might not find it automatically
            // if it expects it at root.
            // BUT, we are downloading to a flattened structure OR preserving structure?
            // Our modelDownloader preserves structure (onnx/model_quantized.onnx).
            // Transformers.js usually handles subdirectories if config.json points to it?
            // No, config.json doesn't usually point to onnx file location.

            // Actually, transformers.js v3 should handle onnx/ subdirectory automatically.
            // The issue might be that we need to pass `dtype: 'q8'` explicitly.

            if (dtype === 'q8') {
              pipelineOptions.dtype = 'q8'
            } else if (dtype === 'int8') {
              pipelineOptions.dtype = 'int8'
            } else {
              // Explicitly set fp32 if that's what we found, to avoid ambiguity
              pipelineOptions.dtype = 'fp32'
            }

            console.log(
              `[WORKER] Starting pipeline initialization for ${type} with options:`,
              JSON.stringify(pipelineOptions)
            )
            const initStart = Date.now()

            if (type === 'initEmbedding') {
              embeddingPipeline = (await pipelineFn(
                'feature-extraction',
                modelPath,
                pipelineOptions
              )) as unknown as FeatureExtractionPipeline
            } else {
              rerankPipeline = (await pipelineFn(
                'text-classification',
                modelPath,
                pipelineOptions
              )) as unknown as RerankPipeline
            }

            console.log(`[WORKER] Pipeline initialization completed in ${Date.now() - initStart}ms`)
          }

          const attemptInit = async (localFilesOnly: boolean) => {
            const timeoutPromise = new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error(`Model initialization timed out after ${timeoutMs}ms`)),
                timeoutMs
              )
            )
            await Promise.race([runPipelineInit(localFilesOnly), timeoutPromise])
          }

          // Set target directory for model files
          const targetDir = path.join(envRef.cacheDir || '.', fullModelName.replace('/', '_'))
          console.log(
            `[WORKER] Target dir: ${targetDir}, offlineFirst: ${offlineFirst}, fullModelName: ${fullModelName}`
          )
          // env.localModelPath acts as the root cache directory
          envRef.localModelPath = envRef.cacheDir || '.'

          try {
            await downloadModelFiles({
              fullModelName,
              targetDir,
              progressManager
            })
          } catch (e) {
            console.warn('[WARN] Download failed, trying to load from cache anyway:', e)
          }

          // Always force local files only
          envRef.allowRemoteModels = false
          await attemptInit(true)

          progressManager.sendUpdate(ProgressStatus.COMPLETED, `模型已完全就绪并可使用`)

          parentPort?.postMessage({
            id,
            type: 'result',
            payload: { success: true }
          })
        } catch (error) {
          console.error('[ERROR] Pipeline initialization failed:', error)
          throw error
        } finally {
          clearInterval(progressCheckInterval)
        }
      } catch (error) {
        progressManager.sendUpdate(
          ProgressStatus.ERROR,
          `Initialization failed: ${error instanceof Error ? error.message : String(error)}`
        )
        throw error
      }
    }

    if (type === 'embed') {
      // 确保嵌入管道已初始化，如果没有则尝试初始化
      if (!embeddingPipeline) {
        console.warn('[WORKER] Embedding pipeline not found, attempting to initialize...')
        
      // 从配置中获取默认模型名称
      const defaultModel = 'multilingual-e5-small'
      // 直接映射模型名称（复制mapModelName逻辑，避免循环依赖）
      const modelMap: Record<string, string> = {
        'bert-base': 'Xenova/bert-base-uncased',
        'bert-large': 'Xenova/bert-large-uncased',
        'sentence-transformers': 'Xenova/all-MiniLM-L6-v2',
        'nomic-bert': 'nomic-ai/nomic-bert-2048',
        'bge-reranker-base': 'Xenova/bge-reranker-base',
        'bge-reranker-v2-m3': 'Xenova/bge-reranker-v2-m3',
        'intfloat/multilingual-e5-small': 'Xenova/multilingual-e5-small',
        'intfloat/multilingual-e5-large': 'Xenova/multilingual-e5-large',
        'intfloat/multilingual-e5-base': 'Xenova/multilingual-e5-base'
      }
      const fullModelName = modelMap[defaultModel] || defaultModel
        
        // 获取缓存目录（从环境变量或默认路径）
        const userDataPath = process.env.USERDATA_PATH || process.cwd()
        const cacheDir = path.join(userDataPath, 'models')
        const targetDir = path.join(cacheDir, fullModelName.replace('/', '_'))
        
        console.log(`[WORKER] Attempting to initialize embedding pipeline for ${defaultModel}`)
        
        try {
          await ensureTransformers()
          if (!env || !pipeline) {
            throw new Error('Transformers not available')
          }
          
          // 设置环境
          env.allowLocalModels = true
          env.allowRemoteModels = false
          env.cacheDir = cacheDir
          env.localModelPath = cacheDir
          
          // 检测模型文件并初始化
          const fs = await import('fs')
          let dtype = 'fp32'
          
          const findFile = async (dir: string, pattern: RegExp): Promise<boolean> => {
            try {
              const entries = await fs.promises.readdir(dir, { withFileTypes: true })
              for (const entry of entries) {
                const fullPath = path.join(dir, entry.name)
                if (entry.isDirectory()) {
                  if (await findFile(fullPath, pattern)) return true
                } else if (pattern.test(entry.name)) {
                  return true
                }
              }
            } catch (e) {
              console.warn('[WORKER] Failed to scan model files:', e)
            }
            return false
          }
          
          if (await findFile(targetDir, /^model_quantized\.onnx$/)) {
            dtype = 'q8'
          } else if (await findFile(targetDir, /^model_int8\.onnx$/)) {
            dtype = 'int8'
          } else if (await findFile(targetDir, /^model\.onnx$/)) {
            dtype = 'fp32'
          }
          
          console.log(`[WORKER] Detected dtype: ${dtype}, loading from ${targetDir}`)
          
          const pipelineOptions: any = {
            local_files_only: true,
            dtype: dtype as any
          }
          
          embeddingPipeline = (await pipeline(
            'feature-extraction',
            targetDir,
            pipelineOptions
          )) as unknown as FeatureExtractionPipeline
          
          console.log('[WORKER] Embedding pipeline initialized successfully')
        } catch (initError) {
          console.error('[WORKER] Failed to initialize embedding pipeline:', initError)
          throw new Error('Embedding pipeline not initialized and auto-initialization failed')
        }
      }
      
      // Support both 'texts' (from workerManager) and 'chunks' (legacy/internal)
      const chunks = payload.texts || payload.chunks

      if (!chunks) {
        throw new Error('No texts provided for embedding')
      }

      console.log(`[WORKER] Starting embedding for ${chunks.length} chunks`)
      const embeddings: number[][] = []

      const total = chunks.length
      const startTime = Date.now()

      for (let i = 0; i < total; i++) {
        const chunkStart = Date.now()
        try {
          const chunk = chunks[i]
          // console.log(`[WORKER] Embedding chunk ${i+1}/${total}, length: ${chunk.length}`)
          const output = await embeddingPipeline(chunk, { pooling: 'mean', normalize: true })
          embeddings.push(Array.from(output.data))

          // Log slow chunks
          const duration = Date.now() - chunkStart
          if (duration > 1000) {
            console.warn(`[WORKER] Slow chunk ${i + 1}: ${duration}ms`)
          }
        } catch (e) {
          console.error(`[WORKER] Failed to embed chunk ${i + 1}:`, e)
          throw e
        }

        // Report progress
        if (i % 10 === 0 || i === total - 1) {
          const progress = Math.round(((i + 1) / total) * 100)
          parentPort?.postMessage({
            id,
            type: 'progress',
            payload: {
              taskType: TaskType.EMBEDDING_GENERATION,
              status: ProgressStatus.PROCESSING,
              message: `Generating embeddings: ${i + 1}/${total}`,
              progress,
              currentIndex: i,
              totalCount: total
            }
          })
        }
      }

      console.log(`[WORKER] Embedding completed in ${Date.now() - startTime}ms`)

      parentPort?.postMessage({
        id,
        type: 'result',
        payload: { embeddings }
      })
    }

    if (type === 'rerank') {
      if (!rerankPipeline) {
        throw new Error('Rerank pipeline not initialized')
      }
      const { query, documents, topK } = payload

      // Construct pairs for reranking
      const pairs = documents.map((doc: string) => {
        return [query, doc]
      })

      // Use the pipeline for classification/reranking
      // Note: Transformers.js zero-shot-classification or specific reranking models might have different signatures
      // Here we assume a text-classification pipeline that outputs scores for the pairs
      // For standard rerankers (CrossEncoder), we usually pass pairs.
      // Transformers.js support for CrossEncoder might vary.
      // Assuming 'text-classification' returns scores.

      const results: { index: number; score: number }[] = []
      for (let i = 0; i < pairs.length; i++) {
        // @ts-ignore - The type definition for rerank pipeline above is a bit simplified
        const output = await rerankPipeline(pairs[i][0], { text_pair: pairs[i][1] })
        // Extract score - this structure depends heavily on the model and pipeline type
        // Usually it returns a list of labels and scores. We need the score for "relevant" or just the raw logit.
        // For BGE-Reranker, it usually outputs a single score.

        // Handling different output formats defensively
        let score = 0
        if (Array.isArray(output)) {
          if (typeof output[0] === 'object' && 'score' in output[0]) {
            // Classification output
            score = output[0].score
          } else if (typeof output[0] === 'number') {
            score = output[0]
          }
        } else if (typeof output === 'object' && 'score' in output) {
          // @ts-ignore - Output type depends on model and pipeline, assuming object with score
          score = output.score
        }

        results.push({ index: i, score })
      }

      // Sort by score descending
      results.sort((a, b) => b.score - a.score)

      // Take top K
      const topResults = results.slice(0, topK || documents.length)

      parentPort?.postMessage({
        id,
        type: 'result',
        payload: {
          indices: topResults.map((r) => r.index),
          scores: topResults.map((r) => r.score)
        }
      })
    }

    if (type === 'loadAndSplit') {
      const { filePath, chunkSize, chunkOverlap } = payload

      parentPort?.postMessage({
        id,
        type: 'progress',
        payload: {
          taskType: TaskType.DOCUMENT_SPLIT,
          status: ProgressStatus.PROCESSING,
          message: 'Reading and splitting file...',
          progress: 0
        }
      })

      const chunks = await loadAndSplitFile(filePath, chunkSize, chunkOverlap)

      parentPort?.postMessage({
        id,
        type: 'result',
        payload: { chunks }
      })
    }
  } catch (error) {
    console.error('Worker error:', error)
    parentPort?.postMessage({
      id,
      type: 'error',
      error: error instanceof Error ? error.message : String(error)
    })
  }
})
