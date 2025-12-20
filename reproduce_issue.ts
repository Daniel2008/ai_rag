import { Worker } from 'worker_threads'
import path from 'path'

const workerPath = path.resolve(__dirname, 'out/main/worker.js')
const worker = new Worker(workerPath)

const embeddingModel = 'sentence-transformers/all-MiniLM-L6-v2'

console.log('Starting worker test...')

worker.on('message', (message) => {
  console.log('Message from worker:', JSON.stringify(message, null, 2))
  if (message.success) {
    console.log('Worker initialization successful!')
    process.exit(0)
  }
  if (message.error) {
    console.error('Worker initialization failed:', message.error)
    process.exit(1)
  }
})

worker.on('error', (err) => {
  console.error('Worker error:', err)
  process.exit(1)
})

worker.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Worker stopped with exit code ${code}`)
    process.exit(code)
  }
})

// Send initialization message
worker.postMessage({
  id: 'test-init',
  type: 'initEmbedding',
  payload: {
    modelName: embeddingModel,
    cacheDir: path.resolve(__dirname, '.tmp-cache'),
    offlineFirst: false // First try with online to ensure download
  }
})
