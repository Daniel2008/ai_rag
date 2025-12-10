import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import * as path from 'path'
import * as fs from 'fs/promises'
import { ProgressCallback, ProgressStatus, TaskType } from './progressTypes'

// OCR 相关类型定义（避免静态导入 ocrProcessor）
type OCRProgressCallback = (progress: {
  stage: string
  percent: number
  currentPage?: number
  totalPages?: number
}) => void

/**
 * 检测文本是否为乱码
 * 乱码特征：大量无意义的标点符号、特殊字符组合，缺少有意义的文字
 */
function isGarbledText(text: string): boolean {
  if (!text || text.length < 50) return false
  
  // 计算各类字符的比例
  const totalChars = text.length
  
  // 有意义的字符：中文、英文字母、数字
  const meaningfulChars = (text.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length
  
  // 标点和特殊字符
  const punctuationChars = (text.match(/[!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~！""''（）【】、，。；：？《》]/g) || []).length
  
  // 如果有意义字符占比低于 30%，且标点符号占比高于 40%，判定为乱码
  const meaningfulRatio = meaningfulChars / totalChars
  const punctuationRatio = punctuationChars / totalChars
  
  // 检查是否有连续的标点符号模式（乱码的典型特征）
  const hasGarbledPattern = /[!"#$%&'()*]{5,}/.test(text) || 
                            /[!"][#$][!"][%&]/.test(text) ||
                            /(!["#$%&]){3,}/.test(text)
  
  return (meaningfulRatio < 0.3 && punctuationRatio > 0.4) || hasGarbledPattern
}

/**
 * 将 ProgressCallback 转换为 OCRProgressCallback
 */
function createOCRProgressAdapter(onProgress?: ProgressCallback): OCRProgressCallback | undefined {
  if (!onProgress) return undefined
  
  return (ocrProgress) => {
    onProgress({
      taskType: TaskType.DOCUMENT_PARSE,
      status: ProgressStatus.PROCESSING,
      message: ocrProgress.stage,
      progress: ocrProgress.percent,
      processedCount: ocrProgress.currentPage,
      totalCount: ocrProgress.totalPages
    })
  }
}

/** 文件类型映射 */
type FileType = 'pdf' | 'word' | 'text' | 'markdown' | 'unknown'

/** 根据扩展名获取文件类型 */
function getFileType(ext: string): FileType {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'pdf'
    case '.doc':
    case '.docx':
      return 'word'
    case '.txt':
      return 'text'
    case '.md':
    case '.markdown':
      return 'markdown'
    default:
      return 'unknown'
  }
}

/** 文档元数据接口 */
export interface DocumentMetadata {
  /** 原始文件路径 */
  source: string
  /** 文件名 */
  fileName: string
  /** 文件类型 */
  fileType: FileType
  /** 页码（PDF 等分页文档） */
  pageNumber: number
  /** 内容在原文档中的位置（字符偏移） */
  position: number
  /** 来源类型 */
  sourceType: 'file' | 'url'
  /** 导入时间 */
  importedAt: string
}

export async function loadAndSplitFile(
  filePath: string,
  onProgress?: ProgressCallback
): Promise<Document[]> {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)
  const fileType = getFileType(ext)
  const importedAt = new Date().toISOString()
  let docs: Document[]

  // 发送开始解析进度
  onProgress?.({
    taskType: TaskType.DOCUMENT_PARSE,
    status: ProgressStatus.PROCESSING,
    message: `开始解析文档: ${fileName}`,
    progress: 0
  })

  // 检查文件是否存在
  onProgress?.({
    taskType: TaskType.DOCUMENT_PARSE,
    status: ProgressStatus.PROCESSING,
    message: `检查文件是否存在: ${fileName}`,
    progress: 10
  })
  
  try {
    await fs.access(filePath, fs.constants.F_OK)
  } catch {
    onProgress?.({
      taskType: TaskType.DOCUMENT_PARSE,
      status: ProgressStatus.ERROR,
      message: `文件不存在: ${fileName}`
    })
    throw new Error(`文件不存在: ${filePath}`)
  }

  // 检查文件是否可读
  onProgress?.({ 
    taskType: TaskType.DOCUMENT_PARSE, 
    status: ProgressStatus.PROCESSING, 
    message: `检查文件权限: ${fileName}`,
    progress: 20 
  })
  
  try {
    await fs.access(filePath, fs.constants.R_OK)
  } catch {
    onProgress?.({ 
      taskType: TaskType.DOCUMENT_PARSE, 
      status: ProgressStatus.ERROR, 
      message: `没有读取文件的权限: ${fileName}` 
    })
    throw new Error(`没有读取文件的权限: ${filePath}`)
  }

  if (ext === '.pdf') {
    onProgress?.({ 
      taskType: TaskType.DOCUMENT_PARSE, 
      status: ProgressStatus.PROCESSING, 
      message: `开始解析PDF文件: ${fileName}`,
      progress: 30 
    })
    
    try {
      const loader = new PDFLoader(filePath, {
        // 尝试按页分割以便更好地处理
        splitPages: true
      })
      docs = await loader.load()
      
      // 检查是否有乱码
      let garbledPageCount = 0
      let totalTextLength = 0
      
      for (const doc of docs) {
        totalTextLength += doc.pageContent.length
        if (isGarbledText(doc.pageContent)) {
          garbledPageCount++
        }
      }
      
      // 如果超过 50% 的页面是乱码，使用 OCR
      const garbledRatio = docs.length > 0 ? garbledPageCount / docs.length : 0
      
      if (garbledRatio > 0.5) {
        console.warn(`[PDF Loader] 检测到 ${fileName} 存在字体编码问题（${garbledPageCount}/${docs.length} 页乱码），启用 OCR 处理`)
        
        onProgress?.({ 
          taskType: TaskType.DOCUMENT_PARSE, 
          status: ProgressStatus.PROCESSING, 
          message: `⚠️ 检测到字体编码问题，启用 OCR 识别...`,
          progress: 35 
        })
        
        // 动态导入 OCR 模块并处理
        const { ocrPDF } = await import('./ocrProcessor')
        const ocrResult = await ocrPDF(filePath, createOCRProgressAdapter(onProgress))
        
        if (ocrResult.success && ocrResult.pages.length > 0) {
          // OCR 成功，使用 OCR 结果替换
          docs = ocrResult.pages.map((pageText, index) => {
            return new Document({
              pageContent: pageText,
              metadata: {
                source: filePath,
                loc: { pageNumber: index + 1 },
                ocrProcessed: true,
                ocrConfidence: ocrResult.confidence
              }
            })
          })
          
          onProgress?.({ 
            taskType: TaskType.DOCUMENT_PARSE, 
            status: ProgressStatus.PROCESSING, 
            message: `OCR 识别完成，共 ${docs.length} 页，置信度 ${Math.round(ocrResult.confidence)}%`,
            progress: 60 
          })
        } else {
          // OCR 失败，保留原始（可能是乱码的）内容并警告
          console.error(`[PDF Loader] OCR 处理失败: ${ocrResult.error}`)
          onProgress?.({ 
            taskType: TaskType.DOCUMENT_PARSE, 
            status: ProgressStatus.PROCESSING, 
            message: `⚠️ OCR 处理失败，保留原始解析结果`,
            progress: 60 
          })
        }
      } else {
        onProgress?.({ 
          taskType: TaskType.DOCUMENT_PARSE, 
          status: ProgressStatus.PROCESSING, 
          message: `PDF文件解析完成，共 ${docs.length} 页`,
          progress: 60 
        })
      }
    } catch (error) {
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.ERROR, 
        message: `PDF文件解析失败: ${fileName}` 
      })
      throw new Error(
        `PDF文件解析失败: ${fileName}。文件可能已损坏或格式不支持。错误详情: ${String(error)}`
      )
    }
  } else if (ext === '.docx' || ext === '.doc') {
    // Word 文档加载
    onProgress?.({ 
      taskType: TaskType.DOCUMENT_PARSE, 
      status: ProgressStatus.PROCESSING, 
      message: `开始解析Word文件: ${fileName}`,
      progress: 30 
    })
    
    try {
      const loader = new DocxLoader(filePath)
      docs = await loader.load()
      
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.PROCESSING, 
        message: `Word文件解析完成`,
        progress: 60 
      })
    } catch (error) {
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.ERROR, 
        message: `Word文件解析失败: ${fileName}` 
      })
      throw new Error(
        `Word文件解析失败: ${fileName}。文件可能已损坏或格式不支持。错误详情: ${String(error)}`
      )
    }
  } else if (ext === '.txt' || ext === '.md') {
    // 自定义文本文件加载逻辑
    onProgress?.({ 
      taskType: TaskType.DOCUMENT_PARSE, 
      status: ProgressStatus.PROCESSING, 
      message: `开始读取文本文件: ${fileName}`,
      progress: 30 
    })
    
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      docs = [new Document({ pageContent: content, metadata: { source: filePath } })]
      
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.PROCESSING, 
        message: `文本文件读取完成`,
        progress: 60 
      })
    } catch (error) {
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.ERROR, 
        message: `文本文件读取失败: ${fileName}` 
      })
      throw new Error(`文本文件读取失败: ${fileName}。错误详情: ${String(error)}`)
    }
  } else {
    throw new Error(`不支持的文件类型: ${ext}。当前只支持PDF、Word、TXT和Markdown文件。`)
  }

  // 发送开始分割进度
  onProgress?.({ 
    taskType: TaskType.DOCUMENT_SPLIT, 
    status: ProgressStatus.PROCESSING, 
    message: `开始分割文档内容`,
    progress: 70 
  })

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1_000,
    chunkOverlap: 200
  })

  const splitDocs = await splitter.splitDocuments(docs)
  
  onProgress?.({ 
    taskType: TaskType.DOCUMENT_SPLIT, 
    status: ProgressStatus.PROCESSING, 
    message: `文档分割完成，共 ${splitDocs.length} 个片段`,
    progress: 85 
  })

  // 计算每个 chunk 的位置
  let currentPosition = 0
  const sanitizedDocs = splitDocs.map((doc) => {
    const locPageNumber = doc.metadata?.loc?.pageNumber
    const resolvedPageNumber =
      typeof locPageNumber === 'number' && Number.isFinite(locPageNumber) ? locPageNumber : 0

    // 估算位置：基于 chunk 索引和平均 chunk 大小
    const position = currentPosition
    currentPosition += doc.pageContent.length

    const metadata: DocumentMetadata = {
      source: typeof doc.metadata?.source === 'string' ? doc.metadata.source : filePath,
      fileName,
      fileType,
      pageNumber: resolvedPageNumber,
      position,
      sourceType: 'file',
      importedAt
    }

    return new Document({
      pageContent: doc.pageContent,
      metadata
    })
  })

  // 发送解析完成进度
  onProgress?.({ 
    taskType: TaskType.DOCUMENT_PARSE, 
    status: ProgressStatus.COMPLETED, 
    message: `文档解析完成: ${fileName}`,
    progress: 100,
    processedCount: sanitizedDocs.length,
    totalCount: sanitizedDocs.length
  })
  
  return sanitizedDocs
}
