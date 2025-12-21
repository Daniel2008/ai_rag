import { Worker } from 'worker_threads'
import path from 'path'
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

import type { Document } from '@langchain/core/documents'

let worker: Worker | null = null
let taskIdCounter = 0

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
  if (worker) return worker

  const workerPath = getWorkerPath()
  console.log('Initializing worker at:', workerPath)

  worker = new Worker(workerPath)

  worker.on('message', (msg: unknown) => {
    if (!isRecord(msg) || typeof msg.type !== 'string') return
    const { id, type } = msg as { id?: unknown; type: unknown }

    if (type === 'log') {
      const payload = (msg as WorkerLogMessage).payload
      const args = Array.isArray(payload?.args) ? payload.args : []
      const message = args.map((a) => (typeof a === 'string' ? a : safeStringify(a))).join(' ')
      const level = payload?.level
      if (level === 'error') logger.error(message, 'Worker')
      else if (level === 'warn') logger.warn(message, 'Worker')
      else logger.info(message, 'Worker')
      return
    }

    const taskId = typeof id === 'number' ? id : NaN
    if (!Number.isFinite(taskId)) return
    const task = pendingTasks.get(taskId)
    if (!task) return

    if (type === 'progress') {
      task.onProgress?.((msg as WorkerProgressMessage).payload)
      return
    }

    if (type === 'result') {
      task.resolve((msg as WorkerResultMessage).payload)
      pendingTasks.delete(taskId)
    } else if (type === 'error') {
      // Create a more informative error object
      const workerError = msg as WorkerErrorMessage
      const errorObj = new Error(workerError.error) as DetailedError
      if (workerError.detailedError) {
        errorObj.detailedError = workerError.detailedError
      }
      task.reject(errorObj)
      pendingTasks.delete(taskId)
    }
  })

  worker.on('error', (err) => {
    console.error('Worker error:', err)
  })

  worker.on('exit', (code) => {
    console.log(`Worker stopped with exit code ${code}`)
    worker = null
  })

  return worker
}

function runTask<T>(type: string, payload: unknown, onProgress?: (p: unknown) => void): Promise<T> {
  const w = initWorker()
  const id = taskIdCounter++

  return new Promise((resolve, reject) => {
    // 使用类型断言解决类型不兼容问题
    pendingTasks.set(id, { resolve: resolve as (res: unknown) => void, reject, onProgress })
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
  const result = await runTask<{ embeddings: number[][] }>('embed', { texts })
  return result.embeddings
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
  if (worker) {
    // 拒绝所有待处理的任务
    for (const [id, task] of pendingTasks.entries()) {
      task.reject(new Error('Worker terminated'))
      pendingTasks.delete(id)
    }
    await worker.terminate()
    worker = null
  }
}
