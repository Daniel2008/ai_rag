import { PDFLoader } from '@langchain/community/document_loaders/fs/pdf'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { Document } from '@langchain/core/documents'
import * as path from 'path'
import * as fs from 'fs/promises'
import { ProgressCallback, ProgressStatus, TaskType } from './progressTypes'
import officeParser from 'officeparser'
import { SemanticChunker, SemanticChunkConfig } from './semanticChunker'

/** 分块策略类型 */
export type ChunkingStrategy = 'semantic' | 'fixed'

/** 分块配置 */
export interface ChunkingConfig {
  /** 分块策略，默认 'semantic' */
  strategy?: ChunkingStrategy
  /** 语义分块配置（仅当 strategy 为 'semantic' 时有效） */
  semanticConfig?: SemanticChunkConfig
  /** 固定分块配置（仅当 strategy 为 'fixed' 时有效） */
  fixedConfig?: {
    chunkSize?: number
    chunkOverlap?: number
  }
}

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

/** 文件类型映射 */
type FileType = 'pdf' | 'word' | 'text' | 'markdown' | 'excel' | 'ppt' | 'unknown'

/** officeparser 支持的文件扩展名（新版 Office 和 OpenDocument 格式）*/
const OFFICE_PARSER_EXTENSIONS = ['.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods']

/** 不支持的旧版 Office 格式（需提示用户转换）*/
const UNSUPPORTED_LEGACY_EXTENSIONS = ['.doc', '.xls', '.ppt']

/** 根据扩展名获取文件类型 */
function getFileType(ext: string): FileType {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'pdf'
    case '.docx':
    case '.odt':
      return 'word'
    case '.txt':
      return 'text'
    case '.md':
    case '.markdown':
      return 'markdown'
    case '.xlsx':
    case '.ods':
      return 'excel'
    case '.pptx':
    case '.odp':
      return 'ppt'
    default:
      return 'unknown'
  }
}

/** 获取文件类型的中文名称 */
function getFileTypeName(ext: string): string {
  switch (ext.toLowerCase()) {
    case '.pdf':
      return 'PDF'
    case '.docx':
    case '.odt':
      return 'Word'
    case '.txt':
      return '文本'
    case '.md':
    case '.markdown':
      return 'Markdown'
    case '.xlsx':
    case '.ods':
      return 'Excel'
    case '.pptx':
    case '.odp':
      return 'PPT'
    default:
      return '文档'
  }
}

/** 尝试根据 BOM 判断编码 */
function detectEncodingFromBOM(buffer: Buffer): 'utf8' | 'utf16le' | 'utf16be' | null {
  if (buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) {
    return 'utf8'
  }
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return 'utf16le'
  }
  if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
    return 'utf16be'
  }
  return null
}

/** 统计替换符数量（�）用于评估解码质量 */
function countReplacementChars(text: string): number {
  return (text.match(/\uFFFD/g) || []).length
}

/** 尝试用多编码解码文本，优先 UTF-8，其次 gb18030，最后 UTF-16 变体 */
function decodeTextBuffer(buffer: Buffer): { text: string; encoding: string } {
  // BOM 优先
  const bom = detectEncodingFromBOM(buffer)
  if (bom === 'utf8') {
    return { text: buffer.toString('utf8'), encoding: 'utf8' }
  }
  if (bom === 'utf16le') {
    return { text: buffer.toString('utf16le'), encoding: 'utf16le' }
  }
  if (bom === 'utf16be') {
    // Node 不直接支持 utf16be，需要手动交换字节
    const swapped = Buffer.alloc(buffer.length - 2)
    for (let i = 2; i < buffer.length; i += 2) {
      swapped[i - 2] = buffer[i + 1]
      swapped[i - 1] = buffer[i]
    }
    return { text: swapped.toString('utf16le'), encoding: 'utf16be' }
  }

  // 无 BOM，尝试 UTF-8 与 GB18030 取较佳
  const utf8Text = buffer.toString('utf8')
  const utf8Bad = countReplacementChars(utf8Text) + (isGarbledText(utf8Text) ? 10_000 : 0)

  let gbText = utf8Text
  let gbBad = utf8Bad
  try {
    const decoder = new TextDecoder('gb18030')
    gbText = decoder.decode(buffer)
    gbBad = countReplacementChars(gbText) + (isGarbledText(gbText) ? 10_000 : 0)
  } catch {
    // 环境不支持 gb18030，忽略
  }

  if (gbBad < utf8Bad) {
    return { text: gbText, encoding: 'gb18030' }
  }
  return { text: utf8Text, encoding: 'utf8' }
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
  onProgress?: ProgressCallback,
  chunkingConfig?: ChunkingConfig
): Promise<Document[]> {
  const ext = path.extname(filePath).toLowerCase()
  const fileName = path.basename(filePath)
  const fileType = getFileType(ext)
  const importedAt = new Date().toISOString()
  let docs: Document[]

  // 默认使用语义分块
  const strategy = chunkingConfig?.strategy ?? 'semantic'

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
      let meaningfulCharsTotal = 0
      
      for (const doc of docs) {
        totalTextLength += doc.pageContent.length
        meaningfulCharsTotal += (doc.pageContent.match(/[\u4e00-\u9fa5a-zA-Z0-9]/g) || []).length
        if (isGarbledText(doc.pageContent)) {
          garbledPageCount++
        }
      }
      
      // 如果超过 50% 的页面是乱码，使用 OCR
      const garbledRatio = docs.length > 0 ? garbledPageCount / docs.length : 0
      const meaningfulRatio = totalTextLength > 0 ? meaningfulCharsTotal / totalTextLength : 0
      
      // 判定：页面乱码比例超过 20% 或整体有效字符比例低于 40%，则认为无法解析
      const isUnparsable = garbledRatio > 0.2 || meaningfulRatio < 0.4
      
      if (isUnparsable) {
        const msg = `检测到文件疑似乱码，无法解析: ${fileName}（页乱码率 ${(
          garbledRatio * 100
        ).toFixed(1)}%，有效字符占比 ${(meaningfulRatio * 100).toFixed(1)}%）`
        console.warn(`[PDF Loader] ${msg}`)
        onProgress?.({
          taskType: TaskType.DOCUMENT_PARSE,
          status: ProgressStatus.ERROR,
          message: msg
        })
        throw new Error(msg)
      }
      
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
  } else if (OFFICE_PARSER_EXTENSIONS.includes(ext)) {
    // 使用 officeparser 处理 Office 和 OpenDocument 文件
    // 支持: .docx, .pptx, .xlsx, .odt, .odp, .ods
    const typeName = getFileTypeName(ext)
    onProgress?.({ 
      taskType: TaskType.DOCUMENT_PARSE, 
      status: ProgressStatus.PROCESSING, 
      message: `开始解析${typeName}文件: ${fileName}`,
      progress: 30 
    })
    
    try {
      const content = await officeParser.parseOfficeAsync(filePath)
      docs = [
        new Document({
          pageContent: content,
          metadata: { source: filePath }
        })
      ]
      
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.PROCESSING, 
        message: `${typeName}文件解析完成`,
        progress: 60 
      })
    } catch (error) {
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.ERROR, 
        message: `${typeName}文件解析失败: ${fileName}` 
      })
      throw new Error(
        `${typeName}文件解析失败: ${fileName}。文件可能已损坏或格式不支持。错误详情: ${String(error)}`
      )
    }
  } else if (UNSUPPORTED_LEGACY_EXTENSIONS.includes(ext)) {
    // 旧版 Office 格式不支持，提示用户转换
    const formatMap: Record<string, { name: string; newExt: string }> = {
      '.doc': { name: 'Word', newExt: '.docx' },
      '.xls': { name: 'Excel', newExt: '.xlsx' },
      '.ppt': { name: 'PPT', newExt: '.pptx' }
    }
    const format = formatMap[ext] || { name: '文档', newExt: '' }
    
    onProgress?.({ 
      taskType: TaskType.DOCUMENT_PARSE, 
      status: ProgressStatus.ERROR, 
      message: `不支持旧版 ${ext} 格式: ${fileName}` 
    })
    throw new Error(
      `不支持旧版 ${ext} 格式: ${fileName}。请使用 Microsoft Office 或 WPS 将文件另存为 ${format.newExt} 格式后再导入。`
    )
  } else if (ext === '.txt' || ext === '.md') {
    // 自定义文本文件加载逻辑
    onProgress?.({ 
      taskType: TaskType.DOCUMENT_PARSE, 
      status: ProgressStatus.PROCESSING, 
      message: `开始读取文本文件: ${fileName}`,
      progress: 30 
    })
    
    try {
      const buffer = await fs.readFile(filePath)
      const { text: content, encoding } = decodeTextBuffer(buffer)
      docs = [
        new Document({
          pageContent: content,
          metadata: { source: filePath, encodingDetected: encoding }
        })
      ]
      
      onProgress?.({ 
        taskType: TaskType.DOCUMENT_PARSE, 
        status: ProgressStatus.PROCESSING, 
        message: `文本文件读取完成（编码: ${encoding}）`,
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
    throw new Error(`不支持的文件类型: ${ext}。当前支持 PDF、Word(.doc/.docx/.odt)、Excel(.xls/.xlsx/.ods)、PPT(.ppt/.pptx/.odp)、TXT 和 Markdown 文件。`)
  }

  // 发送开始分割进度
  onProgress?.({ 
    taskType: TaskType.DOCUMENT_SPLIT, 
    status: ProgressStatus.PROCESSING, 
    message: `开始分割文档内容（策略: ${strategy === 'semantic' ? '语义分块' : '固定分块'}）`,
    progress: 70 
  })

  let splitDocs: Document[]

  if (strategy === 'semantic') {
    // 使用语义分块器（支持 NLP、自定义、固定三种方法）
    const semanticChunker = new SemanticChunker({
      method: 'nlp', // 默认使用 NLP 分块
      maxTokens: 512,
      minChunkSize: 200,
      maxChunkSize: 1500,
      chunkOverlap: 100,
      preserveHeadings: true,
      preserveLists: true,
      preserveCodeBlocks: true,
      preserveTables: true,
      languageMode: 'auto',
      ...chunkingConfig?.semanticConfig
    })
    splitDocs = await semanticChunker.splitDocuments(docs)
  } else {
    // 使用传统固定字符分块
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: chunkingConfig?.fixedConfig?.chunkSize ?? 1000,
      chunkOverlap: chunkingConfig?.fixedConfig?.chunkOverlap ?? 200
    })
    splitDocs = await splitter.splitDocuments(docs)
  }
  
  onProgress?.({ 
    taskType: TaskType.DOCUMENT_SPLIT, 
    status: ProgressStatus.PROCESSING, 
    message: `文档分割完成，共 ${splitDocs.length} 个片段`,
    progress: 85 
  })

  // 计算每个 chunk 的位置
  let currentPosition = 0
  const sanitizedDocs = splitDocs.map((doc, index) => {
    const locPageNumber = doc.metadata?.loc?.pageNumber
    const resolvedPageNumber =
      typeof locPageNumber === 'number' && Number.isFinite(locPageNumber) ? locPageNumber : 0

    // 使用语义分块器提供的位置信息，或估算位置
    const position = doc.metadata?.chunkStartPosition ?? currentPosition
    currentPosition = doc.metadata?.chunkEndPosition ?? (currentPosition + doc.pageContent.length)

    // 构建增强的元数据
    const metadata: DocumentMetadata & {
      chunkIndex?: number
      blockTypes?: string[]
      hasHeading?: boolean
      headingText?: string
      chunkingStrategy?: string
    } = {
      source: typeof doc.metadata?.source === 'string' ? doc.metadata.source : filePath,
      fileName,
      fileType,
      pageNumber: resolvedPageNumber,
      position,
      sourceType: 'file',
      importedAt,
      // 语义分块额外元数据（确保没有 undefined 值，否则 LanceDB 无法推断类型）
      chunkIndex: doc.metadata?.chunkIndex ?? index,
      blockTypes: doc.metadata?.blockTypes ?? [],
      hasHeading: doc.metadata?.hasHeading ?? false,
      headingText: doc.metadata?.headingText ?? '',
      chunkingStrategy: strategy
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
