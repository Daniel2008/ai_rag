import { getDbPath, table } from './core'
import { queryEmbeddingCache } from './query_cache'
import { logWarn } from '../../utils/logger'
import type { VectorStoreStats } from './types'

/**
 * 获取向量存储统计信息
 */
export async function getVectorStoreStats(): Promise<VectorStoreStats> {
  const dbPath = getDbPath()

  // 强制刷新文档数量
  let actualDocCount = 0
  if (table) {
    try {
      actualDocCount = await table.countRows()
    } catch (e) {
      logWarn('Failed to count rows in table', 'VectorStore', undefined, e as Error)
    }
  }

  const { getSettings } = await import('../../settings')
  const settings = getSettings()

  // 获取知识库文件记录数量
  let knowledgeBaseFileCount = 0
  try {
    const { getIndexedFileRecords } = await import('../knowledgeBase')
    knowledgeBaseFileCount = getIndexedFileRecords().length
  } catch (_e) {
    // 忽略
  }

  const stats = {
    docCount: actualDocCount,
    tableExists: table !== null,
    dbPath,
    cacheStats: {
      queryCache: queryEmbeddingCache.getStats()
    },
    config: {
      embeddingProvider: settings.embeddingProvider,
      embeddingModel: settings.embeddingModel
    }
  }

  // 检测不同步问题
  if (knowledgeBaseFileCount > 0 && actualDocCount === 0) {
    logWarn(
      'Vector store is empty but knowledge base has files! Index rebuild required.',
      'VectorStore',
      {
        knowledgeBaseFileCount,
        vectorStoreDocCount: actualDocCount
      }
    )
  } else if (knowledgeBaseFileCount > 0 && actualDocCount < knowledgeBaseFileCount) {
    logWarn('Vector store may be out of sync with knowledge base', 'VectorStore', {
      knowledgeBaseFileCount,
      vectorStoreDocCount: actualDocCount
    })
  }

  return stats
}
