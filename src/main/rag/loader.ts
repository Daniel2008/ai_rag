import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { DocxLoader } from '@langchain/community/document_loaders/fs/docx'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import path from 'path'
import fs from 'fs/promises'

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

export async function loadAndSplitFile(filePath: string): Promise<Document[]> {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)
  const fileType = getFileType(ext)
  const importedAt = new Date().toISOString()
  let docs: Document[]

  if (ext === '.pdf') {
    const loader = new PDFLoader(filePath)
    docs = await loader.load()
  } else if (ext === '.docx' || ext === '.doc') {
    // Word 文档加载
    const loader = new DocxLoader(filePath)
    docs = await loader.load()
  } else if (ext === '.txt' || ext === '.md') {
    // 自定义文本文件加载逻辑
    const content = await fs.readFile(filePath, 'utf-8')
    docs = [new Document({ pageContent: content, metadata: { source: filePath } })]
  } else {
    throw new Error(`Unsupported file type: ${ext}`)
  }

  const splitter = new RecursiveCharacterTextSplitter({
    chunkSize: 1_000,
    chunkOverlap: 200
  })

  const splitDocs = await splitter.splitDocuments(docs)

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

  return sanitizedDocs
}
