/**
 * 向量存储类型定义
 */

import type { Document } from '@langchain/core/documents'
import type { ProgressMessage } from '../progressTypes'

/**
 * LanceDB 原生搜索结果类型
 */
export interface LanceDBSearchResult {
  text?: string
  pageContent?: string
  source?: string
  pageNumber?: number
  vector?: number[]
  metadata?: {
    source?: string
    pageNumber?: number
    [key: string]: unknown
  }
  _distance?: number
  _queryIndex?: number
  _rrfScore?: number
  _bm25Score?: number
}

/**
 * LanceDB 搜索查询接口
 */
export interface LanceDBSearchQuery {
  where?: (clause: string) => LanceDBSearchQuery
  refineFactor?: (factor: number) => LanceDBSearchQuery
  limit: (n: number) => { toArray: () => Promise<LanceDBSearchResult[]> }
}

/**
 * 搜索选项
 */
export interface SearchOptions {
  k?: number
  sources?: string[]
}

/**
 * 带分数的文档结果
 */
export interface ScoredDocument {
  doc: Document
  score: number
}

/**
 * 带距离的文档结果（内部使用）
 */
export interface DocumentWithDistance {
  doc: Document
  distance: number
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (message: ProgressMessage) => void

/**
 * 查询意图类型
 */
export type QueryIntent = 'definition' | 'summary' | 'comparison' | 'other'

/**
 * 缓存统计信息
 */
export interface CacheStats {
  size: number
  hits: number
  misses: number
  hitRate: number
}

/**
 * 向量存储统计信息
 */
export interface VectorStoreStats {
  docCount: number
  tableExists: boolean
  dbPath: string
  cacheStats: {
    queryCache: CacheStats
  }
  config: {
    embeddingProvider: string
    embeddingModel: string
  }
}

/**
 * 相关性检查结果
 */
export interface RelevanceCheckResult {
  relevant: boolean
  matchScore: number
  matchedTerms: string[]
}

/**
 * 文件名搜索结果
 */
export interface FileNameSearchResult {
  results: LanceDBSearchResult[]
  matchedKeywords: string[]
}
