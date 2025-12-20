import fs from 'fs'
import path from 'path'
import { listFiles } from '@huggingface/hub'
import { ProgressManager } from './progressManager'
import { ProgressStatus } from './progressTypes'
import { createRetryingFetch } from './utils/network'

// Force use of HF Mirror
const HF_MIRROR = 'https://hf-mirror.com'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export interface ModelDownloadOptions {
  fullModelName: string
  targetDir: string
  progressManager: ProgressManager
}

export const downloadModelFiles = async (options: ModelDownloadOptions) => {
  const { fullModelName, targetDir, progressManager } = options

  const debugLog = (msg: string) => {
    console.warn(`[DEBUG] ${msg}`)
    progressManager.sendUpdate(ProgressStatus.PROCESSING, `[DEBUG] ${msg}`)
  }

  // Use a custom fetch with retry logic
  const hubFetch = createRetryingFetch({ timeoutMs: 60000, maxRetries: 4 }) as unknown as typeof fetch

  const hasConfig = fs.existsSync(path.join(targetDir, 'config.json'))
  const hasTokenizer = fs.existsSync(path.join(targetDir, 'tokenizer.json'))
  // Check if directory has any ONNX model file
  const hasAnyModelFile = fs.existsSync(targetDir) && fs.readdirSync(targetDir).some(f => f.endsWith('.onnx'))

  if (hasConfig && hasTokenizer && hasAnyModelFile) {
    debugLog('Essential files exist, skipping download')
    return
  }

  await fs.promises.mkdir(targetDir, { recursive: true })

  // 1. List files using @huggingface/hub
  debugLog(`Fetching file list for ${fullModelName} from ${HF_MIRROR}`)

  const fileList: string[] = []
  try {
    const files = await listFiles({
      repo: fullModelName,
      recursive: true,
      hubUrl: HF_MIRROR,
      fetch: hubFetch
    })
    
    // Handle both array and async iterator if necessary, but listFiles usually returns AsyncIterable or Array depending on version.
    // In @huggingface/hub v2+, it returns an AsyncIterable.
    for await (const file of files) {
      if (file.type === 'file') {
        fileList.push(file.path)
      }
    }
    debugLog(`Fetched ${fileList.length} files from API`)
  } catch (e) {
    debugLog(`Failed to list files using library: ${e}`)
    throw new Error(`Failed to list files for model ${fullModelName}: ${e}`)
  }

  if (fileList.length === 0) {
    throw new Error(`No files found for model ${fullModelName}`)
  }

  // Filter files to download
  // We want JSONs, ONNX models, and Tokenizer models
  // But we only need ONE onnx model, preferably quantized.
  
  const allFiles = fileList
  const jsonAndTxtFiles = allFiles.filter(f => f.endsWith('.json') || f.endsWith('.txt') || f.endsWith('.model'))
  const onnxFiles = allFiles.filter(f => f.endsWith('.onnx'))
  
  let selectedOnnxFile: string | undefined
  
  // Priority: 
  // 1. onnx/model_quantized.onnx
  // 2. model_quantized.onnx
  // 3. onnx/model.onnx
  // 4. model.onnx
  // 5. Any other quantized model
  // 6. Any other onnx model
  
  const priorities = [
      'onnx/model_quantized.onnx',
      'model_quantized.onnx',
      'onnx/model.onnx',
      'model.onnx'
  ]
  
  for (const p of priorities) {
      if (onnxFiles.includes(p)) {
          selectedOnnxFile = p
          break
      }
  }
  
  if (!selectedOnnxFile) {
      // If none of the standard names match, try to find *any* quantized model
      selectedOnnxFile = onnxFiles.find(f => f.includes('quantized') || f.includes('int8') || f.includes('q4'))
  }
  
  if (!selectedOnnxFile && onnxFiles.length > 0) {
      // Fallback to the first onnx file found
      selectedOnnxFile = onnxFiles[0]
  }
  
  const filesToDownload = [...jsonAndTxtFiles]
  if (selectedOnnxFile) {
      filesToDownload.push(selectedOnnxFile)
      debugLog(`Selected model file: ${selectedOnnxFile}`)
  } else {
      debugLog('No ONNX model file found in the repository!')
  }

  // Ensure we have at least config and tokenizer
  const required = new Set<string>()
  required.add('config.json')
  required.add('tokenizer.json')
  
  progressManager.sendUpdate(
    ProgressStatus.DOWNLOADING,
    `Downloading ${filesToDownload.length} files`
  )

  const fileStates = progressManager.getFileStates()
  // Initialize file states
  for (const filePath of filesToDownload) {
    fileStates.set(filePath, { loaded: 0, total: 0, completed: false })
  }

  for (const filePath of filesToDownload) {
    const localPath = path.join(targetDir, filePath)
    if (fs.existsSync(localPath)) {
        const state = fileStates.get(filePath)
        if (state) {
            state.completed = true
            state.loaded = state.total || 1
        }
        continue
    }

    const localDir = path.dirname(localPath)
    await fs.promises.mkdir(localDir, { recursive: true })

    try {
      debugLog(`Downloading ${filePath}...`)
      
      // Use downloadFile from @huggingface/hub
      // Note: downloadFile returns a Blob.
      // We explicitly do NOT use `raw: false` here because the library's LFS handling
      // seems to require size information that might be missing or mismatched from the mirror/proxy.
      // Instead, we can try to download directly via fetch for LFS files if needed,
      // OR we just use the raw blob if the library fails to resolve LFS automatically without size info.
      // However, `downloadFile` by default (raw: false) tries to resolve LFS.
      
      // The error "Expected size information" typically comes from `downloadFile` when it tries to verify LFS size.
      // Let's try to bypass the strict check by fetching the file directly using our custom logic if the library fails,
      // OR we can try to pass `downloadInfo` if we had it.
      
      // Better approach: We revert to a direct fetch for the file content from the mirror,
      // bypassing the @huggingface/hub downloadFile validation logic which is causing the issue.
      // We already know the URL structure for the mirror.
      
      const url = `${HF_MIRROR}/${fullModelName}/resolve/main/${filePath}`
      const res = await hubFetch(url)
      
      if (!res.ok) {
         if (res.status === 404 && !required.has(filePath)) {
             debugLog(`Skipping optional file ${filePath} (not found)`)
             continue
         }
         throw new Error(`Failed to download ${filePath}: ${res.status} ${res.statusText}`)
      }

      const total = Number(res.headers.get('content-length')) || 0
      const state = fileStates.get(filePath)
      if (state) {
          state.total = total
      }

      // Stream the download to report progress
      if (!res.body) {
        throw new Error('Response body is null')
      }

      const reader = res.body.getReader()
      const writer = fs.createWriteStream(localPath)
      
      let loaded = 0
      let lastReportedProgress = 0
      
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        
        if (value) {
            writer.write(Buffer.from(value))
            loaded += value.length
            
            if (state) {
                state.loaded = loaded
                
                // Throttle updates: Report every 1% or at least every 1MB
                const currentProgress = progressManager.calculateProgress()
                if (currentProgress - lastReportedProgress >= 1 || loaded % (1024 * 1024) === 0) {
                     const loadedStr = formatBytes(loaded)
                     const totalStr = formatBytes(state.total)
                     progressManager.sendUpdate(
                        ProgressStatus.DOWNLOADING,
                        `Downloading files (${currentProgress.toFixed(0)}%) - ${loadedStr} / ${totalStr}`,
                        filePath,
                        loaded / (state.total || 1)
                      )
                      lastReportedProgress = currentProgress
                }
            }
        }
      }
      
      writer.end()
      
      await new Promise<void>((resolve, reject) => {
          writer.on('finish', resolve)
          writer.on('error', reject)
      })

      // Verify file size
      const stats = await fs.promises.stat(localPath)
      if (stats.size === 0) {
          throw new Error(`File ${filePath} downloaded but has 0 bytes`)
      }
      if (state && state.total > 0 && stats.size !== state.total) {
          debugLog(`[WARN] File ${filePath} size mismatch: expected ${state.total}, got ${stats.size}`)
          // We could throw here, but sometimes content-length is wrong.
          // 0 bytes is definitely wrong though.
      }

      if (state) {
        state.loaded = loaded
        state.completed = true
      }

      // Update progress
      const currentProgress = progressManager.calculateProgress()
      progressManager.sendUpdate(
        ProgressStatus.DOWNLOADING,
        `Downloading files (${currentProgress.toFixed(0)}%)`,
        filePath,
        1
      )

    } catch (e) {
      if (required.has(filePath)) {
        const msg = `Failed to download essential file ${filePath}: ${e}`
        debugLog(msg)
        throw new Error(msg)
      }
      debugLog(`Failed to download optional file ${filePath}: ${e}`)
    }
  }
}
