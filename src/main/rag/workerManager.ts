import { Worker } from 'worker_threads'
import { join } from 'path'
import { app } from 'electron'
import type { Document } from '@langchain/core/documents'

let worker: Worker | null = null
let taskIdCounter = 0
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const pendingTasks = new Map<number, { resolve: (res: any) => void, reject: (err: any) => void, onProgress?: (p: any) => void }>()

function getWorkerPath(): string {
  // In production (bundled), __dirname is .../resources/app.asar/out/main
  // In dev, it is .../out/main
  // The worker file is generated at out/main/worker.js
  return join(__dirname, 'worker.js')
}

export function initWorker(): Worker {
  if (worker) return worker

  const workerPath = getWorkerPath()
  console.log('Initializing worker at:', workerPath)
  
  worker = new Worker(workerPath)
  
  worker.on('message', (msg) => {
    const { id, success, result, error, type, payload } = msg
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
      task.reject(new Error(error))
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function runTask<T>(type: string, payload: any, onProgress?: (p: any) => void): Promise<T> {
  const w = initWorker()
  const id = taskIdCounter++
  
  return new Promise((resolve, reject) => {
    pendingTasks.set(id, { resolve, reject, onProgress })
    w.postMessage({ id, type, payload })
  })
}

export async function loadAndSplitFileInWorker(filePath: string): Promise<Document[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await runTask<any[]>('loadAndSplit', { filePath })
  
  // Rehydrate Documents
  const { Document } = await import('@langchain/core/documents')
  return result.map(d => new Document({ pageContent: d.pageContent, metadata: d.metadata }))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function initEmbeddingInWorker(modelName: string, cacheDir: string, onProgress?: (p: any) => void) {
  return runTask('initEmbedding', { modelName, cacheDir }, onProgress)
}

export async function embedInWorker(texts: string[]): Promise<number[][]> {
  return runTask('embed', { texts })
}
