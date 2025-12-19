/**
 * 向量存储主入口
 * 整合所有子模块，保持公开 API 不变
 */

import { Document } from '@langchain/core/documents'
import { table, initVectorStore, getVectorStore, closeVectorStore, resetVectorStore } from './core'
import {
  getDocCount as getDocCountInternal,
  invalidateDocCountCache,
  getQueryVector,
  getDocCountCached,
  pruneExpiredCaches,
  getQueryCacheStats
} from './query_cache'
import {
  searchSimilarDocumentsWithScores as searchWithScores,
  searchSimilarDocuments as searchDocs
} from './vector_search'
import {
  addDocumentsToStore as addDocs,
  removeSourceFromStore as removeSource,
  removeSourcesFromStore as removeSources
} from './indexing'
import { getVectorStoreStats as getStats } from './stats'
import {
  withEmbeddingProgressSuppressed as withSuppressed,
  setEmbeddingProgressSuppressed as setSuppressed,
  ensureEmbeddingsInitialized as ensureEmbeddingsInit,
  clearEmbeddingsCache as clearEmbeddingsInternal
} from './embeddings'

/**
 * 获取向量表，确保已初始化
 */
export async function getVectorTable() {
  if (!table) {
    await initVectorStore()
  }
  return table
}

import type { SearchOptions, ProgressCallback, ScoredDocument, VectorStoreStats } from './types'

// 重导出类型
export type { SearchOptions, ProgressCallback, VectorStoreStats }

// 重导出嵌入相关
export {
  withSuppressed as withEmbeddingProgressSuppressed,
  setSuppressed as setEmbeddingProgressSuppressed,
  ensureEmbeddingsInit as ensureEmbeddingsInitialized
}

/**
 * 初始化向量存储
 */
export async function initStore(): Promise<void> {
  return initVectorStore()
}

/**
 * 添加文档到存储
 */
export async function addDocumentsToStore(
  docs: Document[],
  onProgress?: ProgressCallback,
  startProgress: number = 0,
  appendMode: boolean = true
): Promise<void> {
  return addDocs(docs, onProgress, startProgress, appendMode)
}

/**
 * 搜索相似文档并返回分数
 */
export async function searchSimilarDocumentsWithScores(
  query: string,
  options: SearchOptions = {}
): Promise<ScoredDocument[]> {
  return searchWithScores(
    query,
    options,
    () => getDocCountCached(table, initVectorStore),
    getQueryVector
  )
}

/**
 * 搜索相似文档
 */
export async function searchSimilarDocuments(
  query: string,
  options: SearchOptions = {}
): Promise<Document[]> {
  return searchDocs(query, options, () => getDocCountCached(table, initVectorStore), getQueryVector)
}

/**
 * 获取文档数量
 */
export async function getDocCount(): Promise<number> {
  return getDocCountInternal(table, initVectorStore)
}

/**
 * 从存储中删除源
 */
export async function removeSourceFromStore(source: string): Promise<void> {
  return removeSource(source)
}

/**
 * 从存储中批量删除源
 */
export async function removeSourcesFromStore(sources: string[]): Promise<void> {
  return removeSources(sources)
}

/**
 * 获取统计信息
 */
export async function getVectorStoreStats(): Promise<VectorStoreStats> {
  return getStats()
}

/**
 * 清理缓存
 */
export async function clearEmbeddingsCache(): Promise<void> {
  await clearEmbeddingsInternal()
  await closeVectorStore()
  const { queryEmbeddingCache } = await import('./query_cache')
  queryEmbeddingCache.clear()
  const { clearBM25Cache } = await import('./bm25')
  clearBM25Cache()
}

// 导出其他实用函数
export {
  invalidateDocCountCache,
  pruneExpiredCaches,
  getQueryCacheStats,
  resetVectorStore,
  closeVectorStore
}

// 默认初始化
export { initVectorStore, getVectorStore }
