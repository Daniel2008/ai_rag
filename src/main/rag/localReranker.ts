/**
 * 本地重排序模型模块
 * 使用 Worker 线程运行 @huggingface/transformers 实现本地 Cross-Encoder 重排序
 */
import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import { initRerankerInWorker, rerankInWorker } from './workerManager'
import { ProgressCallback, ProgressStatus, TaskType } from './progressTypes'
import { RAG_CONFIG } from '../utils/config'

function sendRerankerProgress(progress: Parameters<ProgressCallback>[0]): void {
  if (BrowserWindow?.getAllWindows) {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('embedding:progress', progress)
    })
  }
}

// 配置模型缓存路径
const getModelsPath = (): string => {
  const userDataPath = app?.getPath ? app.getPath('userData') : process.cwd()
  const modelsPath = path.join(userDataPath, 'models')
  if (!fs.existsSync(modelsPath)) {
    fs.mkdirSync(modelsPath, { recursive: true })
  }
  return modelsPath
}

function getMarkerDir(modelsPath: string): string {
  const dir = path.join(modelsPath, '.ai-rag')
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  return dir
}

function sanitizeModelIdForFile(modelId: string): string {
  return modelId.replace(/[^a-zA-Z0-9._-]+/g, '_')
}

function getRerankerMarkerPath(modelsPath: string, modelId: string): string {
  const markerDir = getMarkerDir(modelsPath)
  return path.join(markerDir, `reranker__${sanitizeModelIdForFile(modelId)}.json`)
}

function hasRerankerMarker(modelsPath: string, modelId: string): boolean {
  return fs.existsSync(getRerankerMarkerPath(modelsPath, modelId))
}

function writeRerankerMarker(modelsPath: string, modelId: string): void {
  const markerPath = getRerankerMarkerPath(modelsPath, modelId)
  fs.writeFileSync(
    markerPath,
    JSON.stringify({ modelId, updatedAt: Date.now(), kind: 'reranker' }, null, 2),
    'utf-8'
  )
}

function removeRerankerMarker(modelsPath: string, modelId: string): void {
  const markerPath = getRerankerMarkerPath(modelsPath, modelId)
  if (fs.existsSync(markerPath)) {
    fs.rmSync(markerPath, { force: true })
  }
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
    let retryCount = 0
    const maxRetries = 2

    while (retryCount <= maxRetries) {
      try {
        const modelsPath = getModelsPath()
        const modelLegacyPath = path.join(modelsPath, modelId.split('/').join('--'))
        const modelNestedPath = path.join(modelsPath, modelId.split('/').join(path.sep))
        const modelFlatPath = path.join(modelsPath, sanitizeModelIdForFile(modelId))
        const offlineFirst =
          hasRerankerMarker(modelsPath, modelId) ||
          fs.existsSync(modelLegacyPath) ||
          fs.existsSync(modelNestedPath) ||
          fs.existsSync(modelFlatPath)

        const startingProgress = {
          status: ProgressStatus.DOWNLOADING,
          progress: 10,
          message: `正在加载重排序模型 ${modelName}...`,
          taskType: TaskType.RERANKER_DOWNLOAD
        } satisfies Parameters<ProgressCallback>[0]
        onProgress?.(startingProgress)
        sendRerankerProgress(startingProgress)

        console.log(`[Reranker] Starting initialization for ${modelId}...`)
        await initRerankerInWorker(
          modelId,
          modelsPath,
          (payload) => {
            const payloadObj = payload as Record<string, unknown>
            const base = {
              taskType: TaskType.RERANKER_DOWNLOAD
            } satisfies Partial<Parameters<ProgressCallback>[0]>

            let progressMessage: Parameters<ProgressCallback>[0]

            if (typeof payloadObj.status === 'string' && typeof payloadObj.message === 'string') {
              const progressValue =
                typeof payloadObj.progress === 'number'
                  ? (payloadObj.progress as number)
                  : undefined
              const fileNameValue =
                typeof payloadObj.fileName === 'string'
                  ? (payloadObj.fileName as string)
                  : typeof payloadObj.file === 'string'
                    ? (payloadObj.file as string)
                    : undefined
              const stepValue =
                typeof payloadObj.step === 'string' ? (payloadObj.step as string) : undefined

              progressMessage = {
                ...base,
                status: payloadObj.status as ProgressStatus,
                message: payloadObj.message as string,
                progress: progressValue,
                fileName: fileNameValue,
                step: stepValue
              }
            } else if (
              typeof payloadObj.progress === 'number' &&
              typeof payloadObj.file === 'string'
            ) {
              const rawFile = payloadObj.file as string
              const baseFile =
                rawFile.split('?')[0]?.replace(/\\/g, '/').split('/').pop()?.trim() || rawFile
              const isOpaque =
                (baseFile.length >= 24 &&
                  !baseFile.includes('.') &&
                  /^[a-f0-9]+$/i.test(baseFile)) ||
                /^[a-f0-9]{32,}$/i.test(baseFile)
              const displayFile = isOpaque ? '模型分片' : baseFile
              progressMessage = {
                ...base,
                status: ProgressStatus.DOWNLOADING,
                progress: payloadObj.progress as number,
                fileName: displayFile,
                message: `下载中: ${displayFile} (${Math.round(payloadObj.progress as number)}%)`
              }
            } else if (typeof payloadObj.message === 'string') {
              const progressValue =
                typeof payloadObj.progress === 'number'
                  ? (payloadObj.progress as number)
                  : undefined
              progressMessage = {
                ...base,
                status: ProgressStatus.DOWNLOADING,
                message: payloadObj.message as string,
                progress: progressValue
              }
            } else {
              progressMessage = {
                ...base,
                status: ProgressStatus.DOWNLOADING,
                message: '正在下载重排序模型...'
              }
            }

            onProgress?.(progressMessage)
            sendRerankerProgress(progressMessage)
          },
          offlineFirst
        )
        console.log(`[Reranker] Initialization successful for ${modelId}`)

        writeRerankerMarker(modelsPath, modelId)
        cachedModelName = modelId
        isInitializing = false
        initPromise = null

        const readyProgress = {
          status: ProgressStatus.READY,
          progress: 100,
          message: '重排序模型加载完成',
          taskType: TaskType.RERANKER_DOWNLOAD
        } satisfies Parameters<ProgressCallback>[0]
        onProgress?.(readyProgress)
        sendRerankerProgress(readyProgress)
        return
      } catch (error) {
        retryCount++
        const errorMessage = error instanceof Error ? error.message : String(error)
        const isProtobufError = errorMessage.includes('Protobuf parsing failed')

        if (isProtobufError && retryCount <= maxRetries) {
          console.warn(
            `重排序模型文件可能已损坏 (${errorMessage}), 正在尝试重新下载 (${retryCount}/${maxRetries})...`
          )

          // 尝试清理损坏的模型目录
          try {
            const modelsPath = getModelsPath()
            removeRerankerMarker(modelsPath, modelId)
            // 常见的缓存目录结构处理
            const modelDirName = modelId.split('/').join(path.sep)
            const modelFullPath = path.join(modelsPath, modelDirName)
            const modelLegacyPath = path.join(modelsPath, modelId.split('/').join('--'))

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

          const retryProgress = {
            status: ProgressStatus.DOWNLOADING,
            message: `模型文件损坏，正在重新下载 (${retryCount}/${maxRetries})...`,
            taskType: TaskType.RERANKER_DOWNLOAD
          } satisfies Parameters<ProgressCallback>[0]
          onProgress?.(retryProgress)
          sendRerankerProgress(retryProgress)

          cachedModelName = null
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } else {
          isInitializing = false
          initPromise = null
          cachedModelName = null

          const errorProgress = {
            status: ProgressStatus.ERROR,
            message: `重排序模型加载失败: ${errorMessage}`,
            taskType: TaskType.RERANKER_DOWNLOAD
          } satisfies Parameters<ProgressCallback>[0]
          onProgress?.(errorProgress)
          sendRerankerProgress(errorProgress)
          throw error
        }
      }
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

  const { indices, scores } = await rerankInWorker(query, documents)

  // 映射回索引和分数
  // Worker 已经对结果进行了排序
  const results = indices.map((originalIndex, i) => ({
    index: originalIndex,
    score: scores[i]
  }))

  if (options.topK) {
    return results.slice(0, options.topK)
  }

  return results
}
