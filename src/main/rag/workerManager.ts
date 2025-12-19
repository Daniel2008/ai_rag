import { Worker } from 'worker_threads'
import path from 'path'

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

  worker.on('message', (msg) => {
    const { id, success, result, error, detailedError, type, payload } = msg
    const task = pendingTasks.get(id)
    if (!task) return

    if (type === 'progress') {
      task.onProgress?.(payload)
      return
    }

    if (success) {
      task.resolve(result)
      pendingTasks.delete(id)
    } else {
      // Create a more informative error object
      const errorObj = new Error(error) as DetailedError
      if (detailedError) {
        errorObj.detailedError = detailedError
      }
      task.reject(errorObj)
      pendingTasks.delete(id)
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
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runTask<any[]>('loadAndSplit', { filePath })

  // Rehydrate Documents
  const { Document } = await import('@langchain/core/documents')
  return result.map((d) => new Document({ pageContent: d.pageContent, metadata: d.metadata }))
}

export async function initEmbeddingInWorker(
  modelName: string,
  cacheDir: string,
  onProgress?: (p: unknown) => void
): Promise<unknown> {
  return runTask('initEmbedding', { modelName, cacheDir }, onProgress)
}

export async function embedInWorker(texts: string[]): Promise<number[][]> {
  return runTask('embed', { texts })
}

export async function initRerankerInWorker(
  modelName: string,
  cacheDir: string,
  onProgress?: (p: unknown) => void
): Promise<unknown> {
  return runTask('initReranker', { modelName, cacheDir }, onProgress)
}

export async function rerankInWorker(query: string, documents: string[]): Promise<number[]> {
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
