import { parentPort } from 'worker_threads'
import { pipeline, env } from '@huggingface/transformers'
import { Document } from '@langchain/core/documents'
import { loadAndSplitFile } from './loader'

// Configure transformers
env.remoteHost = 'https://hf-mirror.com/'
env.allowLocalModels = true
env.allowRemoteModels = true

let embeddingPipeline: any = null

if (!parentPort) {
  throw new Error('This file must be run as a worker')
}

parentPort.on('message', async (task) => {
  const { id, type, payload } = task

  try {
    if (type === 'initEmbedding') {
      const { modelName, cacheDir } = payload
      if (cacheDir) {
        env.cacheDir = cacheDir
      }
      
      // Map short name to full model ID if needed, but payload should probably provide full ID or we handle mapping here
      // For now assume payload has correct model ID or we import map
      
      embeddingPipeline = await pipeline('feature-extraction', modelName, {
        progress_callback: (progress: any) => {
          parentPort?.postMessage({
             id,
             type: 'progress',
             payload: progress
          })
        }
      })
      parentPort?.postMessage({ id, success: true })
      
    } else if (type === 'embed') {
      if (!embeddingPipeline) throw new Error('Embedding pipeline not initialized')
      const { texts } = payload
      
      // Run inference
      const output = await embeddingPipeline(texts, { pooling: 'mean', normalize: true })
      
      // Convert Tensor to array
      const embeddings = output.tolist()
      parentPort?.postMessage({ id, success: true, result: embeddings })
      
    } else if (type === 'loadAndSplit') {
      const { filePath } = payload
      const docs = await loadAndSplitFile(filePath)
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
    console.error(`Worker error [${type}]:`, error)
    parentPort?.postMessage({ id, success: false, error: String(error) })
  }
})
