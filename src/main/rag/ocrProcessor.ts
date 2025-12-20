import Tesseract from 'tesseract.js'
import fs from 'fs/promises'
import path from 'path'
import { Document } from '@langchain/core/documents'
import { logInfo, logWarn, logDebug } from '../utils/logger'

export interface OCRConfig {
  languages: string[]
  quality?: 'fast' | 'balanced' | 'high'
  preserveLayout?: boolean
  outputFormat?: 'text' | 'hocr'
}

export interface OCRResult {
  success: boolean
  text: string
  confidence: number
  pageCount: number
  error?: string
  processingTime?: number
}

export interface OCRProgress {
  status: 'initializing' | 'loading' | 'processing' | 'completed' | 'error'
  progress?: number
  page?: number
  totalPages?: number
  message?: string
}

/**
 * OCR处理器 - 处理扫描文档和图片文件
 */
export class OCRProcessor {
  private config: OCRConfig

  constructor(config: OCRConfig) {
    this.config = {
      quality: config.quality || 'balanced',
      preserveLayout: config.preserveLayout || true,
      outputFormat: config.outputFormat || 'text',
      ...config
    }
  }

  /**
   * 处理单个图像文件
   */
  async processImage(
    imagePath: string,
    onProgress?: (progress: OCRProgress) => void
  ): Promise<OCRResult> {
    const startTime = Date.now()

    try {
      // 验证文件存在
      await fs.access(imagePath)

      // 检查文件类型
      const ext = path.extname(imagePath).toLowerCase()
      const supportedFormats = ['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.webp']
      if (!supportedFormats.includes(ext)) {
        return {
          success: false,
          text: '',
          confidence: 0,
          pageCount: 0,
          error: `不支持的图像格式: ${ext}`
        }
      }

      // 进度回调：初始化
      if (onProgress) {
        onProgress({
          status: 'initializing',
          message: '正在初始化OCR引擎...',
          page: 1,
          totalPages: 1
        })
      }

      // 读取图像文件为buffer
      const imageBuffer = await fs.readFile(imagePath)

      const lang = this.config.languages.join('+')
      const options = {
        logger: (m: { status?: string; progress?: number }) => {
          if (onProgress && m.status === 'recognizing text') {
            onProgress({
              status: 'processing',
              progress: (m.progress || 0) * 100,
              message: `正在识别文本... ${Math.round((m.progress || 0) * 100)}%`,
              page: 1,
              totalPages: 1
            })
          }
        }
      } as Parameters<typeof Tesseract.recognize>[2]

      if (this.config.quality === 'fast') {
        ;(options as Record<string, unknown>)['psm'] = 6
      } else if (this.config.quality === 'high') {
        ;(options as Record<string, unknown>)['psm'] = 7
      }

      // 使用Tesseract进行OCR识别
      logDebug('开始OCR处理', 'OCRProcessor', {
        image: imagePath,
        languages: this.config.languages,
        quality: this.config.quality
      })

      const result = await Tesseract.recognize(imageBuffer, lang, options)

      const processingTime = Date.now() - startTime

      // 计算平均置信度
      const avgConfidence = result.data.confidence || 0

      // 提取文本
      let text = result.data.text || ''

      // 如果需要保留布局，添加额外的格式化
      if (this.config.preserveLayout && result.data.blocks) {
        text = this.formatTextWithLayout(
          result.data.blocks as Array<{ text?: string; bbox?: { x0?: number; y0?: number } }>,
          text
        )
      }

      logInfo('OCR处理完成', 'OCRProcessor', {
        image: imagePath,
        confidence: avgConfidence,
        processingTime,
        textLength: text.length
      })

      return {
        success: true,
        text,
        confidence: avgConfidence,
        pageCount: 1,
        processingTime
      }
    } catch (error) {
      const errorMsg = `OCR处理失败: ${(error as Error).message}`
      logWarn('OCR处理失败', 'OCRProcessor', { image: imagePath }, error as Error)

      return {
        success: false,
        text: '',
        confidence: 0,
        pageCount: 0,
        error: errorMsg
      }
    }
  }

  /**
   * 处理PDF文件（需要先转换为图像）
   * 注意：此功能需要额外依赖库，当前返回错误提示
   */
  async processPDF(
    pdfPath: string,
    _onProgress?: (progress: OCRProgress) => void
  ): Promise<OCRResult> {
    const errorMsg = 'PDF处理需要额外的依赖库，请先安装 pdf2image 或其他PDF转图像库'
    logWarn('PDF OCR未实现', 'OCRProcessor', { pdf: pdfPath })

    return {
      success: false,
      text: '',
      confidence: 0,
      pageCount: 0,
      error: errorMsg
    }
  }

  /**
   * 处理批量图像文件
   */
  async processBatch(
    imagePaths: string[],
    onProgress?: (processed: number, total: number, currentFile: string, result?: OCRResult) => void
  ): Promise<OCRResult[]> {
    const results: OCRResult[] = []

    for (let i = 0; i < imagePaths.length; i++) {
      const imagePath = imagePaths[i]

      if (onProgress) {
        onProgress(i, imagePaths.length, path.basename(imagePath))
      }

      const result = await this.processImage(imagePath)

      if (onProgress) {
        onProgress(i + 1, imagePaths.length, path.basename(imagePath), result)
      }

      results.push(result)
    }

    return results
  }

  /**
   * 创建LangChain文档
   */
  createDocumentsFromOCR(ocrResult: OCRResult, metadata: Record<string, unknown> = {}): Document[] {
    if (!ocrResult.success || !ocrResult.text) {
      return []
    }

    // 分割文本（按段落）
    const paragraphs = ocrResult.text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0)

    return paragraphs.map((paragraph, index) => {
      return new Document({
        pageContent: paragraph,
        metadata: {
          ...metadata,
          sourceType: 'ocr',
          ocrConfidence: ocrResult.confidence,
          ocrPageCount: ocrResult.pageCount,
          paragraphIndex: index,
          processingTime: ocrResult.processingTime,
          timestamp: Date.now()
        }
      })
    })
  }

  /**
   * 格式化文本保留布局
   */
  private formatTextWithLayout(
    blocks: Array<{ text?: string; bbox?: { x0?: number; y0?: number } }>,
    rawText: string
  ): string {
    if (!blocks || blocks.length === 0) {
      return rawText
    }

    // 按Y坐标排序块
    const sortedBlocks = blocks.sort((a, b) => {
      const yDiff = (a.bbox?.y0 || 0) - (b.bbox?.y0 || 0)
      if (Math.abs(yDiff) < 10) {
        return (a.bbox?.x0 || 0) - (b.bbox?.x0 || 0)
      }
      return yDiff
    })

    const lines: string[] = []

    let currentY = -1
    let currentLine: string[] = []

    sortedBlocks.forEach((block) => {
      if (!block.text) return

      const y = block.bbox?.y0 || 0

      // 如果Y坐标相差较大，换行
      if (currentY >= 0 && Math.abs(y - currentY) > 20) {
        if (currentLine.length > 0) {
          lines.push(currentLine.join(' '))
          currentLine = []
        }
        currentY = y
      }

      if (currentY < 0) currentY = y

      currentLine.push(block.text.trim())
    })

    if (currentLine.length > 0) {
      lines.push(currentLine.join(' '))
    }

    return lines.join('\n')
  }

  /**
   * 获取可用语言列表
   */
  getAvailableLanguages(): string[] {
    return ['eng', 'chi_sim', 'chi_tra', 'jpn', 'kor', 'deu', 'fra', 'spa', 'rus', 'ara']
  }

  /**
   * 检查语言支持
   */
  async checkLanguageSupport(language: string): Promise<boolean> {
    try {
      // 临时创建worker检查语言支持
      const worker = await Tesseract.createWorker(language)
      await worker.terminate()
      return true
    } catch (error) {
      logWarn('语言不支持', 'OCRProcessor', { language }, error as Error)
      return false
    }
  }
}

/**
 * 创建OCR处理器实例
 */
export function createOCRProcessor(config?: OCRConfig): OCRProcessor {
  const defaultConfig: OCRConfig = {
    languages: ['chi_sim', 'eng'],
    quality: 'balanced',
    preserveLayout: true,
    outputFormat: 'text',
    ...config
  }

  return new OCRProcessor(defaultConfig)
}

/**
 * 便捷函数：处理图像文件并返回LangChain文档
 */
export async function processImageToDocuments(
  imagePath: string,
  config?: OCRConfig,
  onProgress?: (progress: OCRProgress) => void
): Promise<Document[]> {
  const processor = createOCRProcessor(config)
  const result = await processor.processImage(imagePath, onProgress)

  if (!result.success) {
    throw new Error(result.error || 'OCR处理失败')
  }

  return processor.createDocumentsFromOCR(result, {
    source: imagePath,
    fileName: path.basename(imagePath)
  })
}
