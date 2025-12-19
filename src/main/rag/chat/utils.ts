import { Document } from '@langchain/core/documents'
import { ChatSource } from '../../../types/chat'

/** 根据文件名推断文件类型 */
export function inferFileType(fileName: string): ChatSource['fileType'] {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const typeMap: Record<string, ChatSource['fileType']> = {
    pdf: 'pdf',
    doc: 'word',
    docx: 'word',
    txt: 'text',
    md: 'markdown',
    markdown: 'markdown'
  }

  if (ext && typeMap[ext]) return typeMap[ext]

  // 检查是否是 URL
  if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
    return 'url'
  }
  return 'unknown'
}

/** 判断路径是否为 URL */
export function isUrlPath(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
}

/** 从文件路径提取文件名 */
export function extractFileName(filePath: string, title?: string): string {
  if (title) return title

  const pathPart = filePath.split(/[\\/]/).pop() || 'Unknown'
  try {
    return decodeURIComponent(pathPart)
  } catch {
    return pathPart
  }
}

/** 去重：相同文件+页码+内容片段只保留一个，允许同文件多条不同内容 */
export function deduplicateSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Map<string, ChatSource>()

  for (const source of sources) {
    // 使用文件名+页码+内容前50字符作为主键，允许同文件同页的不同内容片段
    const contentKey = source.content?.slice(0, 50) || ''
    const key = `${source.fileName}:${source.pageNumber || 0}:${contentKey}`
    const existing = seen.get(key)

    // 保留分数更高的（仅对完全相同的内容去重）
    if (!existing || (source.score || 0) > (existing.score || 0)) {
      seen.set(key, { ...source })
    }
  }

  // 按分数降序排序
  return Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0))
}

/** 按分数排序返回结果，不再限制每个来源的数量 */
export function ensureSourceDiversity(
  pairs: { doc: Document; score: number }[],
  _minSources: number = 3,
  _maxPerSource: number = 20
): { doc: Document; score: number }[] {
  if (pairs.length === 0) return pairs

  // 直接按分数降序排序返回所有结果，不限制每个来源的数量
  return [...pairs].sort((a, b) => b.score - a.score)
}

/** 将检索到的文档转换为来源信息 */
export function convertDocsToSources(docs: Document[], scores: number[]): ChatSource[] {
  return docs.map((doc, index) => {
    const metadata = doc.metadata || {}
    const filePath = typeof metadata.source === 'string' ? metadata.source : undefined
    const isUrl = filePath ? isUrlPath(filePath) : false
    const fileName = extractFileName(filePath || '', metadata.title || metadata.fileName)

    const rawPageNumber =
      typeof metadata.pageNumber === 'number'
        ? metadata.pageNumber
        : typeof metadata.loc?.pageNumber === 'number'
          ? metadata.loc.pageNumber
          : undefined

    const fileType = metadata.fileType || metadata.type || (isUrl ? 'url' : inferFileType(fileName))
    const score = scores[index] ?? 1 - index * 0.15

    return {
      content: doc.pageContent.slice(0, 300) + (doc.pageContent.length > 300 ? '...' : ''),
      fileName,
      pageNumber: rawPageNumber && rawPageNumber > 0 ? rawPageNumber : undefined,
      filePath,
      fileType: fileType as ChatSource['fileType'],
      score: Math.max(0, score),
      position: typeof metadata.position === 'number' ? metadata.position : undefined,
      sourceType: metadata.sourceType || (isUrl || metadata.type === 'url' ? 'url' : 'file'),
      siteName: metadata.siteName,
      url: isUrl || metadata.type === 'url' ? filePath : undefined,
      fetchedAt: metadata.fetchedAt || metadata.importedAt
    }
  })
}
