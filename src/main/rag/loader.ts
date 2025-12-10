import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import * as path from 'path'
import * as fs from 'fs/promises'
import { ProgressCallback, ProgressStatus, TaskType } from './progressTypes'

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
      const loader = new PDFLoader(filePath)
      docs = await loader.load()
      
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.PROCESSING, 
        message: `PDF文件解析完成，共 ${docs.length} 页`,
        progress: 60 
      })
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
