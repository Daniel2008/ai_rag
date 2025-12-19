/**
 * 语义分块器 - 基于语义边界的智能文本分块
 *
 * 支持两种分块策略:
 * 1. NLP分块 (NLPChunker) - 基于句子边界的语义分块，保持上下文完整性
 * 2. 自定义分块 (CustomChunker) - 识别文档结构（标题、列表、代码块等）
 *
 * 相比固定字符数分块的优势：
 * - 保持语义完整性 - 不会在句子或段落中间断开
 * - 识别文档结构 - 标题、列表、代码块等保持完整
 * - 自适应分块大小 - 根据内容类型动态调整
 */

import { Document } from '@langchain/core/documents'
import { NLPChunker, FixedChunker } from '@orama/chunker'

/** 分块配置 */
export interface SemanticChunkConfig {
  /** 分块方法: 'nlp' (基于NLP句子分割) | 'custom' (自定义结构感知) | 'fixed' (固定大小) */
  method?: 'nlp' | 'custom' | 'fixed'
  /** 目标块大小（token数），默认 512 */
  maxTokens?: number
  /** 最小块大小（字符数），默认 100 */
  minChunkSize?: number
  /** 最大块大小（字符数），默认 2000 */
  maxChunkSize?: number
  /** 块重叠大小（字符数），默认 100 */
  chunkOverlap?: number
  /** 是否保留标题层级，默认 true */
  preserveHeadings?: boolean
  /** 是否保留列表完整性，默认 true */
  preserveLists?: boolean
  /** 是否保留代码块完整性，默认 true */
  preserveCodeBlocks?: boolean
  /** 是否保留表格完整性，默认 true */
  preserveTables?: boolean
  /** 语言模式：中文优先或英文优先 */
  languageMode?: 'chinese' | 'english' | 'auto'
}

/** 内容块类型 */
type ContentBlockType =
  | 'heading'
  | 'paragraph'
  | 'list'
  | 'code'
  | 'table'
  | 'quote'
  | 'separator'
  | 'unknown'

/** 内容块 */
interface ContentBlock {
  type: ContentBlockType
  content: string
  level?: number // 标题级别或列表嵌套级别
  language?: string // 代码语言
  startIndex: number
  endIndex: number
}

/** 分块结果 */
interface ChunkResult {
  content: string
  metadata: {
    chunkIndex: number
    blockTypes: ContentBlockType[]
    hasHeading: boolean
    headingText: string // 必须有值，使用空字符串代替 undefined
    startPosition: number
    endPosition: number
    method: 'nlp' | 'custom' | 'fixed'
  }
}

// 默认配置
const DEFAULT_CONFIG: Required<SemanticChunkConfig> = {
  method: 'nlp',
  maxTokens: 512,
  minChunkSize: 100,
  maxChunkSize: 2000,
  chunkOverlap: 100,
  preserveHeadings: true,
  preserveLists: true,
  preserveCodeBlocks: true,
  preserveTables: true,
  languageMode: 'auto'
}

/**
 * 语义分块器类
 * 整合 @orama/chunker 的 NLP 分块能力和自定义的结构感知分块
 */
export class SemanticChunker {
  private config: Required<SemanticChunkConfig>
  private nlpChunker: NLPChunker
  private fixedChunker: FixedChunker

  constructor(config?: SemanticChunkConfig) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.nlpChunker = new NLPChunker()
    this.fixedChunker = new FixedChunker()
  }

  /**
   * 使用 @orama/chunker 的 NLP 分块
   * 基于句子边界进行分割，保持语义完整性
   */
  private async chunkWithNLP(text: string): Promise<string[]> {
    try {
      const chunks = await this.nlpChunker.chunk(text, this.config.maxTokens)
      return chunks
    } catch (error) {
      console.warn('[SemanticChunker] NLP chunking failed, falling back to custom:', error)
      // 回退到自定义分块
      return this.chunkWithCustom(text)
    }
  }

  /**
   * 使用 @orama/chunker 的固定大小分块
   */
  private async chunkWithFixed(text: string): Promise<string[]> {
    try {
      const chunks = await this.fixedChunker.chunk(text, this.config.maxTokens)
      return chunks
    } catch (error) {
      console.warn('[SemanticChunker] Fixed chunking failed:', error)
      // 简单回退：按字符分割
      const chunkSize = this.config.maxChunkSize
      const result: string[] = []
      for (let i = 0; i < text.length; i += chunkSize) {
        result.push(text.slice(i, i + chunkSize))
      }
      return result
    }
  }

  /**
   * 自定义结构感知分块（保留原有逻辑）
   * 识别标题、代码块、列表等结构
   */
  private chunkWithCustom(text: string): string[] {
    const blocks = this.parseContentBlocks(text)
    const mergedBlocks = this.mergeSmallBlocks(blocks)
    const chunks = this.blocksToChunks(mergedBlocks)
    const overlappedChunks = this.addOverlap(chunks)
    return overlappedChunks.map((c) => c.content)
  }

  /**
   * 检测文本的主要语言
   */
  private detectLanguage(text: string): 'chinese' | 'english' {
    const chineseChars = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const englishChars = (text.match(/[a-zA-Z]/g) || []).length
    return chineseChars > englishChars ? 'chinese' : 'english'
  }

  /**
   * 解析文档结构，识别不同类型的内容块
   */
  private parseContentBlocks(text: string): ContentBlock[] {
    const blocks: ContentBlock[] = []
    const lines = text.split('\n')
    let currentIndex = 0
    let blockStart = 0
    let currentBlock: string[] = []
    let currentType: ContentBlockType = 'paragraph'
    let inCodeBlock = false
    let codeLanguage = ''
    let inTable = false
    let listLevel = 0

    const flushBlock = (): void => {
      if (currentBlock.length > 0) {
        const content = currentBlock.join('\n').trim()
        if (content) {
          blocks.push({
            type: currentType,
            content,
            level: currentType === 'list' ? listLevel : undefined,
            language: currentType === 'code' ? codeLanguage : undefined,
            startIndex: blockStart,
            endIndex: currentIndex
          })
        }
        currentBlock = []
      }
      blockStart = currentIndex
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineLength = line.length + 1 // +1 for newline

      // 代码块检测
      if (line.match(/^```(\w*)/)) {
        if (!inCodeBlock) {
          flushBlock()
          inCodeBlock = true
          codeLanguage = line.match(/^```(\w*)/)?.[1] || ''
          currentType = 'code'
          currentBlock.push(line)
        } else {
          currentBlock.push(line)
          inCodeBlock = false
          flushBlock()
          currentType = 'paragraph'
        }
        currentIndex += lineLength
        continue
      }

      if (inCodeBlock) {
        currentBlock.push(line)
        currentIndex += lineLength
        continue
      }

      // 表格检测
      if (line.match(/^\|.*\|$/)) {
        if (!inTable) {
          flushBlock()
          inTable = true
          currentType = 'table'
        }
        currentBlock.push(line)
        currentIndex += lineLength
        continue
      } else if (inTable) {
        inTable = false
        flushBlock()
        currentType = 'paragraph'
      }

      // 标题检测（Markdown 和常见格式）
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/)
      if (headingMatch) {
        flushBlock()
        blocks.push({
          type: 'heading',
          content: line,
          level: headingMatch[1].length,
          startIndex: currentIndex,
          endIndex: currentIndex + lineLength
        })
        currentIndex += lineLength
        blockStart = currentIndex
        continue
      }

      // 中文标题检测（第X章、一、(一)、1. 等）
      const chineseHeadingMatch = line.match(
        /^(第[一二三四五六七八九十百千\d]+[章节篇部]|[一二三四五六七八九十]+[、.．]|[(（][一二三四五六七八九十\d]+[)）]|[\d]+[.．、]\s*[^\d])/
      )
      if (chineseHeadingMatch && line.length < 100 && !line.match(/[。！？]$/)) {
        flushBlock()
        // 根据标记类型判断级别
        let level = 1
        if (line.match(/^第.+[章部篇]/)) level = 1
        else if (line.match(/^第.+节/)) level = 2
        else if (line.match(/^[一二三四五六七八九十]+[、.．]/)) level = 2
        else if (line.match(/^[(（][一二三四五六七八九十\d]+[)）]/)) level = 3
        else if (line.match(/^[\d]+[.．、]/)) level = 3

        blocks.push({
          type: 'heading',
          content: line,
          level,
          startIndex: currentIndex,
          endIndex: currentIndex + lineLength
        })
        currentIndex += lineLength
        blockStart = currentIndex
        continue
      }

      // 列表检测
      const listMatch = line.match(/^(\s*)([-*•●○◆◇▪▸►]|\d+[.、)）])\s+/)
      if (listMatch) {
        const newListLevel = Math.floor(listMatch[1].length / 2) + 1
        if (currentType !== 'list') {
          flushBlock()
          currentType = 'list'
          listLevel = newListLevel
        }
        currentBlock.push(line)
        currentIndex += lineLength
        continue
      } else if (currentType === 'list' && line.trim() === '') {
        // 列表后的空行结束列表
        flushBlock()
        currentType = 'paragraph'
        currentIndex += lineLength
        continue
      }

      // 引用检测
      if (line.match(/^>\s*/)) {
        if (currentType !== 'quote') {
          flushBlock()
          currentType = 'quote'
        }
        currentBlock.push(line)
        currentIndex += lineLength
        continue
      } else if (currentType === 'quote') {
        flushBlock()
        currentType = 'paragraph'
      }

      // 分隔线检测
      if (line.match(/^[-=_*]{3,}\s*$/)) {
        flushBlock()
        blocks.push({
          type: 'separator',
          content: line,
          startIndex: currentIndex,
          endIndex: currentIndex + lineLength
        })
        currentIndex += lineLength
        blockStart = currentIndex
        continue
      }

      // 空行处理
      if (line.trim() === '') {
        if (currentBlock.length > 0 && currentType === 'paragraph') {
          // 段落之间的空行：结束当前段落
          flushBlock()
        }
        currentIndex += lineLength
        continue
      }

      // 普通段落
      if (currentType !== 'paragraph') {
        flushBlock()
        currentType = 'paragraph'
      }
      currentBlock.push(line)
      currentIndex += lineLength
    }

    // 处理最后一个块
    flushBlock()

    return blocks
  }

  /**
   * 在语义边界处分割文本
   */
  private splitAtSemanticBoundary(text: string, maxLength: number): string[] {
    if (text.length <= maxLength) {
      return [text]
    }

    const language =
      this.config.languageMode === 'auto' ? this.detectLanguage(text) : this.config.languageMode

    // 语义分割点的优先级（从高到低）
    const splitPatterns =
      language === 'chinese'
        ? [
            /[。！？]\s*/g, // 中文句末标点
            /[；;]\s*/g, // 分号
            /[，,]\s*/g, // 逗号
            /[、]\s*/g, // 顿号
            /\s+/g // 空格
          ]
        : [
            /[.!?]\s+/g, // 英文句末标点
            /[;]\s*/g, // 分号
            /[,]\s+/g, // 逗号
            /\s+/g // 空格
          ]

    // 尝试在不同优先级的分割点处分割
    for (const pattern of splitPatterns) {
      const matches = [...text.matchAll(pattern)]
      if (matches.length === 0) continue

      // 找到最接近 maxLength 但不超过的分割点
      let bestSplitIndex = -1
      for (const match of matches) {
        const splitIndex = match.index! + match[0].length
        if (splitIndex <= maxLength && splitIndex > bestSplitIndex) {
          bestSplitIndex = splitIndex
        }
      }

      if (bestSplitIndex > this.config.minChunkSize) {
        const firstPart = text.slice(0, bestSplitIndex).trim()
        const remaining = text.slice(bestSplitIndex).trim()

        if (remaining.length === 0) {
          return [firstPart]
        }

        return [firstPart, ...this.splitAtSemanticBoundary(remaining, maxLength)]
      }
    }

    // 如果找不到合适的分割点，强制在 maxLength 处分割
    const forceSplitIndex = Math.min(maxLength, text.length)
    const firstPart = text.slice(0, forceSplitIndex).trim()
    const remaining = text.slice(forceSplitIndex).trim()

    if (remaining.length === 0) {
      return [firstPart]
    }

    return [firstPart, ...this.splitAtSemanticBoundary(remaining, maxLength)]
  }

  /**
   * 合并小块，确保块大小适中
   */
  private mergeSmallBlocks(blocks: ContentBlock[]): ContentBlock[] {
    const merged: ContentBlock[] = []
    let currentMerge: ContentBlock | null = null

    for (const block of blocks) {
      // 标题块单独保留
      if (block.type === 'heading') {
        if (currentMerge) {
          merged.push(currentMerge)
          currentMerge = null
        }
        merged.push(block)
        continue
      }

      // 代码块、表格如果配置保留完整性，则单独保留
      if (
        (block.type === 'code' && this.config.preserveCodeBlocks) ||
        (block.type === 'table' && this.config.preserveTables)
      ) {
        if (currentMerge) {
          merged.push(currentMerge)
          currentMerge = null
        }
        merged.push(block)
        continue
      }

      // 列表如果配置保留完整性，则单独保留
      if (block.type === 'list' && this.config.preserveLists) {
        if (currentMerge) {
          merged.push(currentMerge)
          currentMerge = null
        }
        merged.push(block)
        continue
      }

      // 分隔符单独处理
      if (block.type === 'separator') {
        if (currentMerge) {
          merged.push(currentMerge)
          currentMerge = null
        }
        continue // 跳过分隔符
      }

      // 尝试合并小块
      if (!currentMerge) {
        currentMerge = { ...block }
      } else {
        const combinedLength = currentMerge.content.length + block.content.length + 2
        if (combinedLength <= this.config.maxChunkSize) {
          currentMerge.content += '\n\n' + block.content
          currentMerge.endIndex = block.endIndex
        } else {
          merged.push(currentMerge)
          currentMerge = { ...block }
        }
      }
    }

    if (currentMerge) {
      merged.push(currentMerge)
    }

    return merged
  }

  /**
   * 将内容块转换为最终的分块结果
   */
  private blocksToChunks(blocks: ContentBlock[]): ChunkResult[] {
    const chunks: ChunkResult[] = []
    let currentChunk: string[] = []
    let currentTypes: ContentBlockType[] = []
    let currentHeading: string | undefined
    let startPosition = 0
    let chunkStartPosition = 0

    const flushChunk = (endPosition: number): void => {
      if (currentChunk.length > 0) {
        const content = currentChunk.join('\n\n').trim()
        if (content.length >= this.config.minChunkSize || currentTypes.includes('heading')) {
          chunks.push({
            content,
            metadata: {
              chunkIndex: chunks.length,
              blockTypes: [...new Set(currentTypes)],
              hasHeading: currentTypes.includes('heading'),
              headingText: currentHeading ?? '',
              startPosition: chunkStartPosition,
              endPosition,
              method: 'custom' as const
            }
          })
        }
        currentChunk = []
        currentTypes = []
        currentHeading = undefined
        chunkStartPosition = endPosition
      }
    }

    for (const block of blocks) {
      // 处理超大块（需要进一步分割）
      if (block.content.length > this.config.maxChunkSize) {
        flushChunk(block.startIndex)

        const subChunks = this.splitAtSemanticBoundary(block.content, this.config.maxChunkSize)
        for (const subChunk of subChunks) {
          chunks.push({
            content: subChunk,
            metadata: {
              chunkIndex: chunks.length,
              blockTypes: [block.type],
              hasHeading: false,
              headingText: '',
              startPosition: block.startIndex,
              endPosition: block.endIndex,
              method: 'custom' as const
            }
          })
        }
        startPosition = block.endIndex
        chunkStartPosition = block.endIndex
        continue
      }

      // 检查是否需要开始新块
      const combinedLength =
        currentChunk.reduce((sum, c) => sum + c.length, 0) + block.content.length
      const shouldStartNew =
        block.type === 'heading' ||
        combinedLength > this.config.maxChunkSize ||
        (block.type === 'code' && currentChunk.length > 0) ||
        (block.type === 'table' && currentChunk.length > 0)

      if (shouldStartNew && currentChunk.length > 0) {
        flushChunk(block.startIndex)
      }

      // 添加到当前块
      currentChunk.push(block.content)
      currentTypes.push(block.type)
      if (block.type === 'heading' && !currentHeading) {
        currentHeading = block.content.replace(/^#+\s*/, '').trim()
      }
      startPosition = block.endIndex
    }

    // 处理最后一个块
    flushChunk(startPosition)

    return chunks
  }

  /**
   * 添加块重叠
   */
  private addOverlap(chunks: ChunkResult[]): ChunkResult[] {
    if (this.config.chunkOverlap <= 0 || chunks.length <= 1) {
      return chunks
    }

    const result: ChunkResult[] = []

    for (let i = 0; i < chunks.length; i++) {
      let content = chunks[i].content

      // 添加前一块的尾部作为上下文
      if (i > 0) {
        const prevContent = chunks[i - 1].content
        const overlapLength = Math.min(this.config.chunkOverlap, prevContent.length)

        // 在语义边界处截取重叠部分
        let overlapStart = prevContent.length - overlapLength
        const sentenceEnd = prevContent.lastIndexOf('。', prevContent.length - 1)
        const periodEnd = prevContent.lastIndexOf('. ', prevContent.length - 1)

        if (sentenceEnd > overlapStart) {
          overlapStart = sentenceEnd + 1
        } else if (periodEnd > overlapStart) {
          overlapStart = periodEnd + 2
        }

        const overlap = prevContent.slice(overlapStart).trim()
        if (overlap && !content.startsWith(overlap)) {
          content = `[...] ${overlap}\n\n${content}`
        }
      }

      result.push({
        ...chunks[i],
        content
      })
    }

    return result
  }

  /**
   * 主入口：执行语义分块
   * 根据配置选择不同的分块策略
   */
  public async splitText(text: string): Promise<ChunkResult[]> {
    if (!text || text.trim().length === 0) {
      return []
    }

    const method = this.config.method

    if (method === 'nlp') {
      // 使用 NLP 分块
      const chunks = await this.chunkWithNLP(text)
      return chunks.map((content, index) => ({
        content,
        metadata: {
          chunkIndex: index,
          blockTypes: ['paragraph'] as ContentBlockType[],
          hasHeading: false,
          headingText: '',
          startPosition: 0,
          endPosition: content.length,
          method: 'nlp' as const
        }
      }))
    } else if (method === 'fixed') {
      // 使用固定大小分块
      const chunks = await this.chunkWithFixed(text)
      return chunks.map((content, index) => ({
        content,
        metadata: {
          chunkIndex: index,
          blockTypes: ['paragraph'] as ContentBlockType[],
          hasHeading: false,
          headingText: '',
          startPosition: 0,
          endPosition: content.length,
          method: 'fixed' as const
        }
      }))
    } else {
      // 使用自定义结构感知分块
      // 1. 解析内容块
      const blocks = this.parseContentBlocks(text)

      // 2. 合并小块
      const mergedBlocks = this.mergeSmallBlocks(blocks)

      // 3. 转换为最终分块
      const chunks = this.blocksToChunks(mergedBlocks)

      // 4. 添加重叠
      const overlappedChunks = this.addOverlap(chunks)

      return overlappedChunks.map((chunk) => ({
        ...chunk,
        metadata: {
          ...chunk.metadata,
          method: 'custom' as const
        }
      }))
    }
  }

  /**
   * 同步版本的 splitText（仅支持 custom 方法）
   */
  public splitTextSync(text: string): ChunkResult[] {
    if (!text || text.trim().length === 0) {
      return []
    }

    // 1. 解析内容块
    const blocks = this.parseContentBlocks(text)

    // 2. 合并小块
    const mergedBlocks = this.mergeSmallBlocks(blocks)

    // 3. 转换为最终分块
    const chunks = this.blocksToChunks(mergedBlocks)

    // 4. 添加重叠
    const overlappedChunks = this.addOverlap(chunks)

    return overlappedChunks.map((chunk) => ({
      ...chunk,
      metadata: {
        ...chunk.metadata,
        method: 'custom' as const
      }
    }))
  }

  /**
   * 分割 LangChain Document 数组
   */
  public async splitDocuments(documents: Document[]): Promise<Document[]> {
    const result: Document[] = []

    for (const doc of documents) {
      const chunks = await this.splitText(doc.pageContent)

      for (const chunk of chunks) {
        result.push(
          new Document({
            pageContent: chunk.content,
            metadata: {
              ...doc.metadata,
              chunkIndex: chunk.metadata.chunkIndex ?? 0,
              blockTypes: chunk.metadata.blockTypes ?? [],
              hasHeading: chunk.metadata.hasHeading ?? false,
              headingText: chunk.metadata.headingText ?? '',
              chunkStartPosition: chunk.metadata.startPosition ?? 0,
              chunkEndPosition: chunk.metadata.endPosition ?? chunk.content.length,
              chunkingMethod: chunk.metadata.method ?? 'unknown'
            }
          })
        )
      }
    }

    return result
  }
}

/**
 * 便捷函数：创建语义分块器实例
 */
export function createSemanticChunker(config?: SemanticChunkConfig): SemanticChunker {
  return new SemanticChunker(config)
}

/**
 * 便捷函数：直接分割文本（异步）
 */
export async function splitTextSemantically(
  text: string,
  config?: SemanticChunkConfig
): Promise<ChunkResult[]> {
  const chunker = new SemanticChunker(config)
  return chunker.splitText(text)
}

/**
 * 便捷函数：直接分割文本（同步，仅支持 custom 方法）
 */
export function splitTextSemanticallySync(
  text: string,
  config?: SemanticChunkConfig
): ChunkResult[] {
  const chunker = new SemanticChunker({ ...config, method: 'custom' })
  return chunker.splitTextSync(text)
}

/**
 * 便捷函数：直接分割 Documents
 */
export async function splitDocumentsSemantically(
  documents: Document[],
  config?: SemanticChunkConfig
): Promise<Document[]> {
  const chunker = new SemanticChunker(config)
  return chunker.splitDocuments(documents)
}

/** 导出类型 */
export type { ChunkResult, ContentBlockType, ContentBlock }

export default SemanticChunker
