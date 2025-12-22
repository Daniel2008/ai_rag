import { Worker } from 'worker_threads'
import path from 'path'
import type { Document } from '@langchain/core/documents'
import { logger } from '../utils/logger'

// 扩展Error类型，添加detailedError属性
declare interface DetailedError extends Error {
  detailedError?: {
    type: string
    message: string
    stack?: string
    cause?: unknown
  }
}

// Worker 池管理 - 支持多 Worker 并行处理
interface WorkerPool {
  workers: Map<number, Worker>
  taskQueues: Map<number, Task[]>
  maxWorkers: number
  activeWorkers: number
}

const workerPool: WorkerPool = {
  workers: new Map(),
  taskQueues: new Map(),
  maxWorkers: Math.min(4, require('os').cpus().length), // 最多4个worker或CPU核心数
  activeWorkers: 0
}

let taskIdCounter = 0
let globalWorker: Worker | null = null // 保持向后兼容

type WorkerLogMessage = {
  id?: number
  type: 'log'
  payload: { level: 'info' | 'warn' | 'error'; args: unknown[] }
}

type WorkerProgressMessage = { id: number; type: 'progress'; payload: unknown }

type WorkerResultMessage = { id: number; type: 'result'; payload: unknown }

type WorkerErrorMessage = {
  id: number
  type: 'error'
  error: string
  detailedError?: DetailedError['detailedError']
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

// 定义任务类型
interface Task<T = unknown> {
  resolve: (res: T | PromiseLike<T>) => void
  reject: (err: Error) => void
  onProgress?: (p: unknown) => void
}

const pendingTasks = new Map<number, Task>()

function getWorkerPath(): string {
  // 根据当前环境选择worker文件路径
  // 如果当前文件是.ts扩展名，说明在开发环境中运行TypeScript文件
  if (__filename.endsWith('.ts')) {
    // 在开发环境中直接使用worker.ts文件
    return path.join(__dirname, 'worker.ts')
  } else {
    // 在生产环境中使用编译后的worker.js文件
    return path.join(__dirname, 'worker.js')
  }
}

export function initWorker(): Worker {
  if (globalWorker) return globalWorker

  const workerPath = getWorkerPath()
  console.log('Initializing worker at:', workerPath)

  globalWorker = createWorker(workerPath, 0)
  return globalWorker
}

/**
 * 创建单个 Worker 实例
 */
function createWorker(workerPath: string, workerId: number): Worker {
  const worker = new Worker(workerPath)

  worker.on('message', (msg: unknown) => {
    if (!isRecord(msg) || typeof msg.type !== 'string') return
    const { id, type } = msg as { id?: unknown; type: unknown }

    if (type === 'log') {
      const payload = (msg as WorkerLogMessage).payload
      const args = Array.isArray(payload?.args) ? payload.args : []
      const message = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
      const level = payload?.level
      if (level === 'error') logger.error(message, `Worker-${workerId}`)
      else if (level === 'warn') logger.warn(message, `Worker-${workerId}`)
      else logger.info(message, `Worker-${workerId}`)
      return
    }

    const taskId = typeof id === 'number' ? id : NaN
    if (!Number.isFinite(taskId)) return

    // 查找任务对应的 worker
    const task = pendingTasks.get(taskId)
    if (!task) return

    if (type === 'progress') {
      task.onProgress?.((msg as WorkerProgressMessage).payload)
      return
    }

    if (type === 'result') {
      task.resolve((msg as WorkerResultMessage).payload)
      pendingTasks.delete(taskId)
      // 清理内存
      if (task.onProgress) task.onProgress = undefined
    } else if (type === 'error') {
      const workerError = msg as WorkerErrorMessage
      const errorObj = new Error(workerError.error) as DetailedError
      if (workerError.detailedError) {
        errorObj.detailedError = workerError.detailedError
      }
      task.reject(errorObj)
      pendingTasks.delete(taskId)
      // 清理内存
      if (task.onProgress) task.onProgress = undefined
    }
  })

  worker.on('error', (err) => {
    console.error(`Worker-${workerId} error:`, err)
    // 错误恢复机制
    setTimeout(() => {
      if (workerPool.workers.has(workerId)) {
        console.log(`Attempting to restart Worker-${workerId}`)
        const newWorker = createWorker(workerPath, workerId)
        workerPool.workers.set(workerId, newWorker)
      }
    }, 1000)
  })

  worker.on('exit', (code) => {
    console.log(`Worker-${workerId} stopped with exit code ${code}`)
    workerPool.workers.delete(workerId)
    workerPool.activeWorkers = Math.max(0, workerPool.activeWorkers - 1)

    // 如果是全局 worker，清除引用
    if (globalWorker === worker) {
      globalWorker = null
    }
  })

  return worker
}

/**
 * 智能任务调度 - 选择最合适的 worker
 */
function selectWorker(): Worker {
  // 如果只有一个任务，使用全局 worker
  if (pendingTasks.size === 0) {
    return initWorker()
  }

  // 如果任务较多，创建新的 worker
  if (pendingTasks.size > 3 && workerPool.activeWorkers < workerPool.maxWorkers) {
    const workerPath = getWorkerPath()
    const workerId = workerPool.activeWorkers + 1
    const newWorker = createWorker(workerPath, workerId)
    workerPool.workers.set(workerId, newWorker)
    workerPool.activeWorkers++
    return newWorker
  }

  // 否则使用现有的全局 worker
  return initWorker()
}

function runTask<T>(type: string, payload: unknown, onProgress?: (p: unknown) => void): Promise<T> {
  const w = selectWorker()
  const id = taskIdCounter++

  return new Promise((resolve, reject) => {
    // 使用类型断言解决类型不兼容问题
    pendingTasks.set(id, { resolve: resolve as (res: unknown) => void, reject, onProgress })

    // 内存优化：大任务使用超时保护
    const timeoutMs = type === 'loadAndSplit' ? 300000 : 60000 // 5分钟 vs 1分钟

    const timeout = setTimeout(() => {
      const task = pendingTasks.get(id)
      if (task) {
        task.reject(new Error(`Task timeout after ${timeoutMs}ms`))
        pendingTasks.delete(id)
      }
    }, timeoutMs)

    // 包装 resolve/reject 以清理超时
    const originalResolve = pendingTasks.get(id)!.resolve
    const originalReject = pendingTasks.get(id)!.reject

    pendingTasks.set(id, {
      resolve: (result) => {
        clearTimeout(timeout)
        originalResolve(result)
      },
      reject: (error) => {
        clearTimeout(timeout)
        originalReject(error)
      },
      onProgress
    })

    w.postMessage({ id, type, payload })
  })
}

export async function loadAndSplitFileInWorker(filePath: string): Promise<Document[]> {
  const result = await runTask<{
    chunks: Array<{ pageContent: string; metadata: Record<string, unknown> }>
  }>('loadAndSplit', { filePath })

  // Rehydrate Documents
  const { Document } = await import('@langchain/core/documents')
  return result.chunks.map(
    (d) => new Document({ pageContent: d.pageContent, metadata: d.metadata })
  )
}

export async function initEmbeddingInWorker(
  modelName: string,
  cacheDir: string,
  onProgress?: (p: unknown) => void,
  offlineFirst?: boolean
): Promise<unknown> {
  return runTask('initEmbedding', { modelName, cacheDir, offlineFirst }, onProgress)
}

export async function embedInWorker(texts: string[]): Promise<number[][]> {
  // 确保先初始化嵌入管道
  try {
    const result = await runTask<{ embeddings: number[][] }>('embed', { texts })
    return result.embeddings
  } catch (error) {
    // 如果是嵌入管道未初始化错误，先初始化再重试
    if (error instanceof Error && error.message.includes('Embedding pipeline not initialized')) {
      console.warn('Embedding pipeline not initialized, attempting to reinitialize...')
      
      // 强制重新初始化嵌入模型
      const { initLocalEmbeddings } = await import('./localEmbeddings')
      // 直接使用默认模型名称，避免循环依赖
      const modelName = 'multilingual-e5-small'
      
      try {
        await initLocalEmbeddings(modelName, (progress) => {
          console.log('Reinitializing embedding model:', progress.message)
        })
      } catch (initError) {
        console.error('Failed to reinitialize embedding model:', initError)
        throw initError
      }
      
      // 重试嵌入
      const result = await runTask<{ embeddings: number[][] }>('embed', { texts })
      return result.embeddings
    }
    throw error
  }
}

export async function initRerankerInWorker(
  modelName: string,
  cacheDir: string,
  onProgress?: (p: unknown) => void,
  offlineFirst?: boolean
): Promise<unknown> {
  return runTask('initReranker', { modelName, cacheDir, offlineFirst }, onProgress)
}

export async function rerankInWorker(
  query: string,
  documents: string[]
): Promise<{ indices: number[]; scores: number[] }> {
  return runTask('rerank', { query, documents })
}

/**
 * 终止文档处理 Worker
 */
export async function terminateDocumentWorker(): Promise<void> {
  // 拒绝所有待处理的任务
  for (const [id, task] of pendingTasks.entries()) {
    task.reject(new Error('Worker terminated'))
    pendingTasks.delete(id)
  }

  // 终止所有 worker
  const terminationPromises: Promise<void>[] = []

  if (globalWorker) {
    terminationPromises.push(
      globalWorker.terminate().then(() => {
        globalWorker = null
      })
    )
  }

  for (const [id, worker] of workerPool.workers.entries()) {
    terminationPromises.push(
      worker.terminate().then(() => {
        workerPool.workers.delete(id)
      })
    )
  }

  await Promise.all(terminationPromises)

  // 清理 pool
  workerPool.workers.clear()
  workerPool.activeWorkers = 0

  // 强制垃圾回收（如果可用）
  if (global.gc) {
    global.gc()
  }
}

/**
 * 获取 Worker 状态信息
 */
export function getWorkerStatus(): {
  globalWorker: boolean
  poolWorkers: number
  activeTasks: number
  maxWorkers: number
} {
  return {
    globalWorker: !!globalWorker,
    poolWorkers: workerPool.workers.size,
    activeTasks: pendingTasks.size,
    maxWorkers: workerPool.maxWorkers
  }
}

/**
 * 手动触发内存清理
 */
export function cleanupWorkerMemory(): void {
  // 如果任务队列为空且有额外的 worker，清理它们
  if (pendingTasks.size === 0 && workerPool.workers.size > 1) {
    const workersToTerminate = Array.from(workerPool.workers.entries())
      .slice(1) // 保留第一个 worker
      .map(([id, worker]) =>
        worker.terminate().then(() => {
          workerPool.workers.delete(id)
          workerPool.activeWorkers--
        })
      )

    Promise.all(workersToTerminate).then(() => {
      console.log('Cleaned up extra workers')
    })
  }
}
