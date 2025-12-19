import { LRUCache } from './cache'
import { RAG_CONFIG } from '../../utils/config'
import { logWarn } from '../../utils/logger'
import type { Embeddings } from '@langchain/core/embeddings'
import type { Table } from '@lancedb/lancedb'

// 查询向量缓存
export const queryEmbeddingCache = new LRUCache<string, number[]>(
  RAG_CONFIG.EMBEDDING.QUERY_CACHE_SIZE,
  5 * 60 * 1000 // 5 分钟过期
)

// 文档数量缓存
export let cachedDocCount: number | null = null
export let docCountCacheTime: number = 0

/**
 * 获取缓存的文档数量
 */
export async function getDocCountCached(
  table: Table | null,
  initVectorStore: () => Promise<void>
): Promise<number> {
  const now = Date.now()
  if (cachedDocCount !== null && now - docCountCacheTime < RAG_CONFIG.DOC_COUNT_CACHE.TTL) {
    return cachedDocCount
  }

  if (!table) {
    await initVectorStore()
  }

  // 再次检查 table，因为 initVectorStore 可能失败
  if (!table) return 0

  try {
    cachedDocCount = await table.countRows()
    docCountCacheTime = now
    return cachedDocCount
  } catch (e) {
    logWarn('Failed to get doc count', 'VectorStore', undefined, e as Error)
    return cachedDocCount ?? 0
  }
}

/**
 * 失效文档数量缓存
 */
export function invalidateDocCountCache(): void {
  cachedDocCount = null
  docCountCacheTime = 0
}

/**
 * 获取文档数量
 */
export async function getDocCount(
  table: Table | null,
  initVectorStore: () => Promise<void>
): Promise<number> {
  return getDocCountCached(table, initVectorStore)
}

/**
 * 获取查询向量（带缓存）
 */
export async function getQueryVector(query: string, embeddings: Embeddings): Promise<number[]> {
  const cached = queryEmbeddingCache.get(query)
  if (cached) return cached
  const vec = await embeddings.embedQuery(query)
  queryEmbeddingCache.set(query, vec)
  return vec
}

/**
 * 清理过期缓存
 */
export function pruneExpiredCaches() {
  const pruned = queryEmbeddingCache.prune()
  return { pruned }
}

/**
 * 获取查询缓存统计
 */
export function getQueryCacheStats() {
  return queryEmbeddingCache.getStats()
}
