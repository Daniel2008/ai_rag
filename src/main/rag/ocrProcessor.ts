/**
 * OCR 处理模块
 * 使用 tesseract.js 进行文字识别，支持中英文
 */
import { createWorker, Worker, OEM, PSM } from 'tesseract.js'
import * as fs from 'fs/promises'
import * as path from 'path'
import { app } from 'electron'

// 延迟加载 pdfjs-dist 和 canvas，避免在 Worker 初始化时出错
let pdfjs: typeof import('pdfjs-dist') | null = null
let createCanvasFn: typeof import('canvas').createCanvas | null = null

async function ensurePdfjs() {
  if (!pdfjs) {
    // 使用 legacy 版本，兼容 Node.js 环境
    pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
    // 禁用 worker
    pdfjs.GlobalWorkerOptions.workerSrc = ''
  }
  return pdfjs
}

async function ensureCanvas() {
  if (!createCanvasFn) {
    const canvasModule = await import('canvas')
    createCanvasFn = canvasModule.createCanvas
  }
  return createCanvasFn
}

/** OCR 进度回调 */
export type OCRProgressCallback = (progress: {
  stage: string
  percent: number
  currentPage?: number
  totalPages?: number
}) => void

/** OCR 结果 */
export interface OCRResult {
  success: boolean
  text: string
  pages: string[]
  confidence: number
  error?: string
}

// 缓存 Tesseract Worker
let cachedWorker: Worker | null = null
let isWorkerInitializing = false
let workerInitPromise: Promise<Worker> | null = null

/**
 * 获取或创建 Tesseract Worker
 */
async function getOCRWorker(onProgress?: OCRProgressCallback): Promise<Worker> {
  if (cachedWorker) {
    return cachedWorker
  }

  if (isWorkerInitializing && workerInitPromise) {
    return workerInitPromise
  }

  isWorkerInitializing = true
  
  workerInitPromise = (async () => {
    onProgress?.({ stage: '正在初始化 OCR 引擎...', percent: 5 })
    
    // 获取语言数据缓存路径
    const langPath = path.join(
      app?.getPath ? app.getPath('userData') : process.cwd(),
      'tesseract-lang'
    )
    
    // 确保目录存在
    await fs.mkdir(langPath, { recursive: true })

    const worker = await createWorker('chi_sim+eng', OEM.LSTM_ONLY, {
      cachePath: langPath,
      logger: (m) => {
        if (m.status === 'loading tesseract core') {
          onProgress?.({ stage: '加载 OCR 核心引擎...', percent: 10 })
        } else if (m.status === 'initializing tesseract') {
          onProgress?.({ stage: '初始化 OCR 引擎...', percent: 15 })
        } else if (m.status === 'loading language traineddata') {
          onProgress?.({ stage: '加载中英文语言包...', percent: 20 })
        } else if (m.status === 'initializing api') {
          onProgress?.({ stage: 'OCR 引擎准备就绪', percent: 25 })
        }
      }
    })

    // 设置 OCR 参数
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO, // 自动页面分割
      preserve_interword_spaces: '1'   // 保留单词间空格
    })

    cachedWorker = worker
    isWorkerInitializing = false
    
    return worker
  })()

  return workerInitPromise
}

/**
 * 将 PDF 页面渲染为图片
 */
async function renderPDFPageToImage(
  page: any, // PDFPageProxy
  scale: number = 2.0
): Promise<Buffer> {
  const createCanvas = await ensureCanvas()
  const viewport = page.getViewport({ scale })
  
  // 创建 canvas
  const canvas = createCanvas(viewport.width, viewport.height)
  const context = canvas.getContext('2d')
  
  // 设置白色背景
  context.fillStyle = 'white'
  context.fillRect(0, 0, viewport.width, viewport.height)

  // 渲染 PDF 页面到 canvas
  await page.render({
    canvasContext: context as unknown as CanvasRenderingContext2D,
    viewport
  }).promise

  // 转换为 PNG Buffer
  return canvas.toBuffer('image/png')
}

/**
 * 对单张图片进行 OCR
 */
async function recognizeImage(
  worker: Worker,
  imageBuffer: Buffer
): Promise<{ text: string; confidence: number }> {
  const result = await worker.recognize(imageBuffer)
  return {
    text: result.data.text,
    confidence: result.data.confidence
  }
}

/**
 * 对 PDF 文件进行 OCR 处理
 */
export async function ocrPDF(
  filePath: string,
  onProgress?: OCRProgressCallback
): Promise<OCRResult> {
  try {
    onProgress?.({ stage: '开始 OCR 处理...', percent: 0 })

    // 延迟加载 pdfjs
    const pdf = await ensurePdfjs()
    
    // 读取 PDF 文件
    const pdfData = await fs.readFile(filePath)
    const pdfDoc = await pdf.getDocument({ data: pdfData }).promise
    const numPages = pdfDoc.numPages

    onProgress?.({ 
      stage: `PDF 加载完成，共 ${numPages} 页`, 
      percent: 5,
      totalPages: numPages 
    })

    // 获取 OCR Worker
    const worker = await getOCRWorker(onProgress)

    const pages: string[] = []
    let totalConfidence = 0

    // 逐页处理
    for (let i = 1; i <= numPages; i++) {
      const pagePercent = 25 + Math.floor((i / numPages) * 70)
      
      onProgress?.({ 
        stage: `正在识别第 ${i}/${numPages} 页...`, 
        percent: pagePercent,
        currentPage: i,
        totalPages: numPages
      })

      // 获取页面
      const page = await pdfDoc.getPage(i)
      
      // 渲染为图片
      const imageBuffer = await renderPDFPageToImage(page)
      
      // OCR 识别
      const { text, confidence } = await recognizeImage(worker, imageBuffer)
      
      pages.push(text)
      totalConfidence += confidence

      // 清理页面资源
      page.cleanup()
    }

    const avgConfidence = numPages > 0 ? totalConfidence / numPages : 0

    onProgress?.({ stage: 'OCR 处理完成', percent: 100 })

    return {
      success: true,
      text: pages.map((p, i) => `--- 第 ${i + 1} 页 ---\n\n${p}`).join('\n\n'),
      pages,
      confidence: avgConfidence
    }
  } catch (error) {
    console.error('[OCR] 处理失败:', error)
    return {
      success: false,
      text: '',
      pages: [],
      confidence: 0,
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
}

/**
 * 对单张图片进行 OCR
 */
export async function ocrImage(
  imagePath: string,
  onProgress?: OCRProgressCallback
): Promise<OCRResult> {
  try {
    onProgress?.({ stage: '开始 OCR 处理...', percent: 0 })

    const imageBuffer = await fs.readFile(imagePath)
    const worker = await getOCRWorker(onProgress)

    onProgress?.({ stage: '正在识别图片...', percent: 50 })

    const { text, confidence } = await recognizeImage(worker, imageBuffer)

    onProgress?.({ stage: 'OCR 处理完成', percent: 100 })

    return {
      success: true,
      text,
      pages: [text],
      confidence
    }
  } catch (error) {
    console.error('[OCR] 图片处理失败:', error)
    return {
      success: false,
      text: '',
      pages: [],
      confidence: 0,
      error: error instanceof Error ? error.message : '未知错误'
    }
  }
}

/**
 * 清理 OCR Worker 资源
 */
export async function terminateOCRWorker(): Promise<void> {
  if (cachedWorker) {
    await cachedWorker.terminate()
    cachedWorker = null
    isWorkerInitializing = false
    workerInitPromise = null
  }
}

/**
 * 检查 OCR 引擎是否可用
 */
export function isOCRAvailable(): boolean {
  return true // tesseract.js 是纯 JavaScript，总是可用
}

