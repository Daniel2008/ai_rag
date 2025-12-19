import { ChatSource } from '../../types/chat'
import { getTagsForFile } from '../rag/tagManager'
import { getIndexedFileRecords } from '../rag/knowledgeBase'
import { normalizePath } from '../rag/pathUtils'

/**
 * 引用溯源工具 - 增强引用信息的完整性和可视化支持
 */

export interface EnhancedCitation extends ChatSource {
  /** 增强的上下文信息 */
  enhanced?: {
    /** 文档大小 */
    fileSize?: string
    /** 文档创建时间 */
    createdAt?: string
    /** 文档最后更新时间 */
    updatedAt?: string
    /** 相关文档数量 */
    relatedDocsCount?: number
    /** 文档标签名称 */
    tagNames?: string[]
    /** 来源统计 */
    sourceStats?: {
      vector?: number
      keyword?: number
      ocr?: number
    }
    /** 相关内容预览 */
    preview?: string
    /** 段落位置 */
    positionInfo?: string
  }
}

/**
 * 增强引用信息 - 补充文档元数据和上下文
 */
export async function enhanceCitation(
  baseSource: ChatSource,
  options: {
    includeRelatedContent?: boolean
    includeTags?: boolean
    includeMetadata?: boolean
    maxRelatedContent?: number
  } = {}
): Promise<EnhancedCitation> {
  const {
    includeRelatedContent = true,
    includeTags = true,
    includeMetadata = true,
    maxRelatedContent = 3
  } = options

  const enhanced: EnhancedCitation = { ...baseSource }
  const enhancedInfo: any = {}

  // 1. 获取文档元数据
  if (includeMetadata && baseSource.filePath) {
    const records = getIndexedFileRecords()
    const normalizedPath = normalizePath(baseSource.filePath)
    const fileRecord = records.find(r => 
      (r.normalizedPath ?? normalizePath(r.path)) === normalizedPath
    )

    if (fileRecord) {
      // 文件大小格式化
      if (fileRecord.size) {
        enhancedInfo.fileSize = formatFileSize(fileRecord.size)
      }

      // 时间信息
      if (fileRecord.createdAt) {
        enhancedInfo.createdAt = new Date(fileRecord.createdAt).toLocaleString('zh-CN')
      }
      if (fileRecord.updatedAt) {
        enhancedInfo.updatedAt = new Date(fileRecord.updatedAt).toLocaleString('zh-CN')
      }

      // 版本信息
      if (fileRecord.currentVersion) {
        enhanced.version = fileRecord.currentVersion
      }

      // 元数据
      if (fileRecord.metadata) {
        enhanced.metadata = fileRecord.metadata
      }
    }
  }

  // 2. 获取标签信息
  if (includeTags && baseSource.filePath) {
    try {
      const tags = await getTagsForFile(baseSource.filePath)
      if (tags.length > 0) {
        enhanced.tags = tags.map(t => t.name)
        enhancedInfo.tagNames = tags.map(t => t.name)
      }
    } catch (error) {
      // 标签获取失败不影响主流程
    }
  }

  // 3. 生成相关内容预览
  if (includeRelatedContent && baseSource.content) {
    const related = generateRelatedContent(baseSource.content, baseSource.relatedContent)
    if (related.length > 0) {
      enhancedInfo.preview = related[0]
      enhanced.relatedContent = related.slice(0, maxRelatedContent)
    }
  }

  // 4. 位置信息
  if (baseSource.pageNumber !== undefined || baseSource.position !== undefined) {
    const parts: string[] = []
    if (baseSource.pageNumber !== undefined) {
      parts.push(`第 ${baseSource.pageNumber} 页`)
    }
    if (baseSource.position !== undefined) {
      parts.push(`位置 ${baseSource.position}`)
    }
    if (baseSource.paragraphIndex !== undefined) {
      parts.push(`段落 ${baseSource.paragraphIndex + 1}`)
    }
    if (parts.length > 0) {
      enhancedInfo.positionInfo = parts.join(' · ')
    }
  }

  // 5. 来源统计
  if (baseSource.searchSources && baseSource.searchSources.length > 0) {
    const stats: any = {}
    baseSource.searchSources.forEach(source => {
      stats[source] = (stats[source] || 0) + 1
    })
    enhancedInfo.sourceStats = stats
  }

  // 6. OCR特殊信息
  if (baseSource.sourceType === 'ocr' && baseSource.ocrConfidence !== undefined) {
    enhancedInfo.ocrQuality = baseSource.ocrConfidence >= 0.9 ? '高' : 
                             baseSource.ocrConfidence >= 0.7 ? '中' : '低'
  }

  enhanced.enhanced = enhancedInfo
  return enhanced
}

/**
 * 批量增强引用信息
 */
export async function enhanceCitations(
  sources: ChatSource[],
  options?: Parameters<typeof enhanceCitation>[1]
): Promise<EnhancedCitation[]> {
  const promises = sources.map(source => enhanceCitation(source, options))
  return Promise.all(promises)
}

/**
 * 生成相关内容预览
 */
function generateRelatedContent(
  mainContent: string,
  relatedContents?: string[]
): string[] {
  const results: string[] = []
  
  // 添加主内容预览
  const trimmed = mainContent.trim()
  if (trimmed.length > 0) {
    // 按句子分割，保留完整的句子
    const sentences = trimmed.split(/(?<=[。！？.!?])\s+/)
    if (sentences.length > 1) {
      // 取前2-3个句子
      results.push(sentences.slice(0, 3).join(' '))
    } else {
      // 如果内容较短，直接使用
      results.push(trimmed.length > 200 ? trimmed.substring(0, 200) + '...' : trimmed)
    }
  }

  // 添加相关片段
  if (relatedContents && relatedContents.length > 0) {
    relatedContents.forEach(content => {
      const trimmed = content.trim()
      if (trimmed.length > 0 && trimmed !== mainContent.trim()) {
        results.push(trimmed.length > 150 ? trimmed.substring(0, 150) + '...' : trimmed)
      }
    })
  }

  return results
}

/**
 * 格式化文件大小
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 创建引用可视化数据
 */
export function createCitationVisualization(
  citations: EnhancedCitation[]
): {
  sources: string[]
  tags: string[]
  fileTypes: string[]
  sourceTypes: string[]
  confidence: number[]
  scores: number[]
  stats: {
    total: number
    byType: Record<string, number>
    byTag: Record<string, number>
    byFileType: Record<string, number>
    avgConfidence: number
    avgScore: number
  }
} {
  const sources = new Set<string>()
  const tags = new Set<string>()
  const fileTypes = new Set<string>()
  const sourceTypes = new Set<string>()
  const confidence: number[] = []
  const scores: number[] = []

  const stats = {
    total: citations.length,
    byType: {} as Record<string, number>,
    byTag: {} as Record<string, number>,
    byFileType: {} as Record<string, number>,
    avgConfidence: 0,
    avgScore: 0
  }

  citations.forEach(citation => {
    // 来源文件
    if (citation.filePath) sources.add(citation.filePath)

    // 标签
    if (citation.tags) {
      citation.tags.forEach(tag => tags.add(tag))
    }

    // 文件类型
    if (citation.fileType) {
      fileTypes.add(citation.fileType)
      stats.byFileType[citation.fileType] = (stats.byFileType[citation.fileType] || 0) + 1
    }

    // 来源类型
    if (citation.sourceType) {
      sourceTypes.add(citation.sourceType)
      stats.byType[citation.sourceType] = (stats.byType[citation.sourceType] || 0) + 1
    }

    // 分数
    if (citation.score !== undefined) {
      scores.push(citation.score)
    }

    // OCR置信度
    if (citation.ocrConfidence !== undefined) {
      confidence.push(citation.ocrConfidence)
    }
  })

  // 计算平均值
  if (scores.length > 0) {
    stats.avgScore = scores.reduce((a, b) => a + b, 0) / scores.length
  }
  if (confidence.length > 0) {
    stats.avgConfidence = confidence.reduce((a, b) => a + b, 0) / confidence.length
  }

  // 统计标签
  tags.forEach(tag => {
    const count = citations.filter(c => c.tags && c.tags.includes(tag)).length
    stats.byTag[tag] = count
  })

  return {
    sources: Array.from(sources),
    tags: Array.from(tags),
    fileTypes: Array.from(fileTypes),
    sourceTypes: Array.from(sourceTypes),
    confidence,
    scores,
    stats
  }
}

/**
 * 生成引用摘要
 */
export function generateCitationSummary(citations: EnhancedCitation[]): string {
  if (citations.length === 0) {
    return '未找到相关引用'
  }

  const visualization = createCitationVisualization(citations)
  
  let summary = `共引用 ${citations.length} 个来源`
  
  if (visualization.sources.length > 0) {
    summary += `，来自 ${visualization.sources.length} 个文档`
  }

  if (visualization.tags.length > 0) {
    summary += `，涉及 ${visualization.tags.length} 个主题：${visualization.tags.slice(0, 3).join('、')}`
    if (visualization.tags.length > 3) {
      summary += ` 等`
    }
  }

  const fileTypes = Array.from(visualization.fileTypes)
  if (fileTypes.length > 0) {
    summary += `，包含 ${fileTypes.join('、')} 类型文件`
  }

  if (visualization.stats.avgScore > 0) {
    summary += `，平均相关度 ${(visualization.stats.avgScore * 100).toFixed(0)}%`
  }

  // 详细统计
  const typeDetails: string[] = []
  Object.entries(visualization.stats.byType).forEach(([type, count]) => {
    typeDetails.push(`${type === 'file' ? '文件' : type === 'url' ? 'URL' : 'OCR'}: ${count}个`)
  })
  if (typeDetails.length > 0) {
    summary += `（${typeDetails.join('，')}）`
  }

  return summary
}

/**
 * 检查引用质量
 */
export function validateCitations(citations: ChatSource[]): {
  valid: ChatSource[]
  warnings: string[]
} {
  const valid: ChatSource[] = []
  const warnings: string[] = []

  citations.forEach((citation, index) => {
    const issues: string[] = []

    // 检查必要字段
    if (!citation.content || citation.content.trim().length === 0) {
      issues.push('内容为空')
    }

    if (!citation.fileName && !citation.filePath) {
      issues.push('缺少文件标识')
    }

    // 检查分数
    if (citation.score !== undefined && (citation.score < 0 || citation.score > 1)) {
      issues.push('分数超出范围')
    }

    // 检查OCR置信度
    if (citation.sourceType === 'ocr' && citation.ocrConfidence !== undefined) {
      if (citation.ocrConfidence < 0.5) {
        issues.push('OCR置信度较低')
      }
    }

    if (issues.length > 0) {
      warnings.push(`引用 ${index + 1}: ${issues.join(', ')} (${citation.fileName || citation.filePath})`)
    } else {
      valid.push(citation)
    }
  })

  return { valid, warnings }
}

/**
 * 排序引用
 */
export function sortCitations(
  citations: ChatSource[],
  strategy: 'relevance' | 'quality' | 'source' | 'date' = 'relevance'
): ChatSource[] {
  const sorted = [...citations]

  switch (strategy) {
    case 'relevance':
      sorted.sort((a, b) => (b.score || 0) - (a.score || 0))
      break

    case 'quality':
      sorted.sort((a, b) => {
        const aQuality = a.ocrConfidence || (a.score || 0)
        const bQuality = b.ocrConfidence || (b.score || 0)
        return bQuality - aQuality
      })
      break

    case 'source':
      sorted.sort((a, b) => {
        const aSource = a.sourceType || 'unknown'
        const bSource = b.sourceType || 'unknown'
        return aSource.localeCompare(bSource)
      })
      break

    case 'date':
      sorted.sort((a, b) => {
        const aDate = a.fetchedAt ? new Date(a.fetchedAt).getTime() : 0
        const bDate = b.fetchedAt ? new Date(b.fetchedAt).getTime() : 0
        return bDate - aDate
      })
      break
  }

  return sorted
}

/**
 * 生成引用导出数据
 */
export function exportCitations(
  citations: EnhancedCitation[],
  format: 'json' | 'markdown' | 'text' = 'json'
): string {
  if (format === 'json') {
    return JSON.stringify(citations, null, 2)
  }

  if (format === 'markdown') {
    let md = '## 引用来源\n\n'
    citations.forEach((citation, index) => {
      md += `### ${index + 1}. ${citation.fileName}\n\n`
      md += `**来源类型**: ${citation.sourceType || '未知'}\n\n`
      
      if (citation.enhanced?.positionInfo) {
        md += `**位置**: ${citation.enhanced.positionInfo}\n\n`
      }

      if (citation.score !== undefined) {
        md += `**相关度**: ${(citation.score * 100).toFixed(0)}%\n\n`
      }

      if (citation.tags && citation.tags.length > 0) {
        md += `**标签**: ${citation.tags.join(', ')}\n\n`
      }

      md += `**内容**:\n> ${citation.content}\n\n`

      if (citation.enhanced?.preview) {
        md += `**预览**:\n> ${citation.enhanced.preview}\n\n`
      }

      if (citation.filePath) {
        md += `**路径**: \`${citation.filePath}\`\n\n`
      }

      md += '---\n\n'
    })
    return md
  }

  if (format === 'text') {
    let text = '引用来源\n'
    text += '='.repeat(50) + '\n\n'
    
    citations.forEach((citation, index) => {
      text += `${index + 1}. ${citation.fileName}\n`
      text += `   类型: ${citation.sourceType || '未知'}\n`
      if (citation.enhanced?.positionInfo) {
        text += `   位置: ${citation.enhanced.positionInfo}\n`
      }
      if (citation.score !== undefined) {
        text += `   相关度: ${(citation.score * 100).toFixed(0)}%\n`
      }
      if (citation.tags && citation.tags.length > 0) {
        text += `   标签: ${citation.tags.join(', ')}\n`
      }
      text += `   内容: ${citation.content.substring(0, 100)}${citation.content.length > 100 ? '...' : ''}\n`
      text += '\n'
    })
    
    return text
  }

  return ''
}
