/**
 * 向量存储主入口
 * 整合所有子模块，保持公开 API 不变
 */

import type { LanceDB } from '@langchain/community/vectorstores/lancedb'
import type { Connection, Table } from '@lancedb/lancedb'
import type { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'

// 导入子模块
import type {
  SearchOptions,
  LanceDBSearchResult,
  LanceDBSearchQuery,
  ProgressCallback,
  VectorStoreStats,
  DocumentWithDistance,
  ScoredDocument
} from './types'
import { LRUCache } from './cache'
import {
  normalizePath,
  escapePredicateValue,
  calculateFetchK,
  estimateQueryComplexity,
  classifyQueryIntent,
  filterResultsBySource,
  distanceToScore,
  buildSourceWhereClause,
  diversifyBySource
} from './utils'
import { reciprocalRankFusion, mmrRerankByContent } from './algorithms'
import { getSettings } from '../../settings'
import {
  getEmbeddings,
  ensureEmbeddingsInitialized as ensureEmbeddingsInit,
  clearEmbeddingsCache as clearEmbeddingsInternal,
  withEmbeddingProgressSuppressed as withSuppressed,
  setEmbeddingProgressSuppressed as setSuppressed
} from './embeddings'
import { filterByRelevanceThreshold, searchByFileName, extractFileNameKeywords } from './search'
import { getBM25Searcher, clearBM25Cache } from './bm25'

// 导入外部依赖
import { LocalEmbeddings } from '../localEmbeddings'
import { ProgressStatus, TaskType } from '../progressTypes'
import { RAG_CONFIG } from '../../utils/config'
import { logDebug, logInfo, logWarn, logError } from '../../utils/logger'
import { memoryMonitor } from '../../utils/memoryMonitor'
import { createProcessingProgress, createCompletedMessage } from '../../utils/progressHelper'

// 重导出类型和函数
export type { SearchOptions, ProgressCallback }
export {
  withSuppressed as withEmbeddingProgressSuppressed,
  setSuppressed as setEmbeddingProgressSuppressed
}
export { ensureEmbeddingsInit as ensureEmbeddingsInitialized }

// ==================== 模块级变量 ====================

const TABLE_NAME = 'documents'

// LanceDB 连接
let db: Connection | null = null
let table: Table | null = null
let vectorStore: LanceDB | null = null
let LanceDBCtor: typeof import('@langchain/community/vectorstores/lancedb').LanceDB | null = null
let connectFn: typeof import('@lancedb/lancedb').connect | null = null

// 查询向量缓存
const queryEmbeddingCache = new LRUCache<string, number[]>(
  RAG_CONFIG.EMBEDDING.QUERY_CACHE_SIZE,
  5 * 60 * 1000 // 5 分钟过期
)

// 文档数量缓存
let cachedDocCount: number | null = null
let docCountCacheTime: number = 0

// ==================== 内部函数 ====================

async function loadLanceModules(): Promise<void> {
  if (!LanceDBCtor) {
    const mod = await import('@langchain/community/vectorstores/lancedb')
    LanceDBCtor = mod.LanceDB
  }
  if (!connectFn) {
    const mod = await import('@lancedb/lancedb')
    connectFn = mod.connect
  }
}

function getDbPath(): string {
  let dbPath: string
  if (app?.getPath) {
    dbPath = path.join(app.getPath('userData'), 'lancedb')
  } else {
    dbPath = path.join(process.cwd(), '.lancedb')
  }
  // 打印路径以便调试开发/生产环境差异
  console.log('[LanceDB] Database path:', dbPath)
  console.log('[LanceDB] app.isPackaged:', app?.isPackaged)
  console.log('[LanceDB] userData:', app?.getPath?.('userData'))
  return dbPath
}

async function getDocCountCached(): Promise<number> {
  const now = Date.now()
  if (cachedDocCount !== null && now - docCountCacheTime < RAG_CONFIG.DOC_COUNT_CACHE.TTL) {
    return cachedDocCount
  }

  if (!table) {
    await initVectorStore()
    if (!table) return 0
  }

  try {
    cachedDocCount = await table.countRows()
    docCountCacheTime = now
    return cachedDocCount
  } catch (e) {
    logWarn('Failed to get doc count', 'VectorStore', undefined, e as Error)
    return cachedDocCount ?? 0
  }
}

async function createVectorIndexIfNeeded(tableRef: Table): Promise<void> {
  const { INDEX } = RAG_CONFIG.LANCEDB
  if (!INDEX.ENABLED) return

  try {
    const rowCount = await tableRef.countRows()
    if (rowCount < 500) {
      logDebug('Skipping index creation (table too small)', 'VectorStore', { rowCount })
      return
    }

    const indices = await (
      tableRef as unknown as { listIndices?: () => Promise<{ name: string }[]> }
    ).listIndices?.()
    if (indices && indices.some((idx) => idx.name === 'vector_idx')) {
      logDebug('Vector index already exists', 'VectorStore')
      return
    }

    logInfo('Creating HNSW vector index...', 'VectorStore', { rowCount })
    const startTime = Date.now()

    const createIndexFn = (
      tableRef as unknown as {
        createIndex: (column: string, options?: Record<string, unknown>) => Promise<void>
      }
    ).createIndex

    if (typeof createIndexFn === 'function') {
      await createIndexFn.call(tableRef, 'vector', {
        type: 'IVF_HNSW_SQ',
        num_partitions: Math.min(INDEX.NUM_PARTITIONS, Math.ceil(rowCount / 100)),
        num_sub_vectors: INDEX.NUM_SUB_VECTORS,
        metric_type: INDEX.METRIC,
        index_name: 'vector_idx'
      })
      logInfo(`Vector index created in ${Date.now() - startTime}ms`, 'VectorStore')
    }
  } catch (e) {
    logWarn('Failed to create vector index (non-fatal)', 'VectorStore', undefined, e as Error)
  }
}

async function ensureTableWithDocuments(
  docs: Document[],
  appendMode: boolean = false
): Promise<LanceDB> {
  const dbPath = getDbPath()
  const embeddings = getEmbeddings()

  if (!db) {
    await loadLanceModules()
    db = await connectFn!(dbPath)
  }

  const conn = db as Connection
  const tableNames = await conn.tableNames()
  const tableExists = tableNames.includes(TABLE_NAME)

  // 如果表存在且是追加模式，使用 LanceDB 原生追加
  if (tableExists && appendMode) {
    logInfo('Appending documents to existing LanceDB table', 'VectorStore', {
      docCount: docs.length
    })

    try {
      // 确保 table 引用存在
      if (!table) {
        table = await conn.openTable(TABLE_NAME)
      }

      // 生成向量嵌入
      const texts = docs.map((d) => d.pageContent)
      const vectors = await embeddings.embedDocuments(texts)

      // 准备要插入的数据 - 只包含现有 schema 中的字段
      // LanceDB 表 schema: vector, text, source, fileName, fileType, pageNumber,
      //                    position, sourceType, importedAt, chunkIndex, blockTypes,
      //                    hasHeading, headingText, chunkingStrategy
      const records = docs.map((doc, i) => ({
        vector: vectors[i],
        text: doc.pageContent,
        source: doc.metadata?.source ?? null,
        fileName: doc.metadata?.fileName ?? null,
        fileType: doc.metadata?.fileType ?? null,
        pageNumber: doc.metadata?.pageNumber ?? null,
        position: doc.metadata?.position ?? null,
        sourceType: doc.metadata?.sourceType ?? null,
        importedAt: doc.metadata?.importedAt ?? null,
        chunkIndex: doc.metadata?.chunkIndex ?? null,
        blockTypes: doc.metadata?.blockTypes ?? [],
        hasHeading: doc.metadata?.hasHeading ?? false,
        headingText: doc.metadata?.headingText ?? '',
        chunkingStrategy: doc.metadata?.chunkingStrategy ?? null
      }))

      // 使用 LanceDB 原生 add 方法追加数据
      await (table as unknown as { add: (data: unknown[]) => Promise<void> }).add(records)

      // 刷新 table 引用
      table = await conn.openTable(TABLE_NAME)
      await createVectorIndexIfNeeded(table)

      // 如果 vectorStore 不存在，创建它
      if (!vectorStore) {
        await loadLanceModules()
        vectorStore = new LanceDBCtor!(embeddings, { table })
      }

      logInfo(`Appended ${docs.length} documents to LanceDB (native add)`, 'VectorStore')
      return vectorStore
    } catch (appendError) {
      logWarn(
        'Failed to append documents via native add, falling back to recreate',
        'VectorStore',
        undefined,
        appendError as Error
      )
      // 追加失败，回退到重建模式
    }
  }

  // 创建新表或重建表
  logInfo('Creating/updating LanceDB table with documents', 'VectorStore', {
    docCount: docs.length,
    tableExists,
    appendMode
  })

  await loadLanceModules()
  const store = await LanceDBCtor!.fromDocuments(docs, embeddings, {
    uri: dbPath,
    tableName: TABLE_NAME
  })

  const conn2 = db as Connection
  const newTableNames = await conn2.tableNames()
  if (newTableNames.includes(TABLE_NAME)) {
    table = await conn2.openTable(TABLE_NAME)
    await createVectorIndexIfNeeded(table)
  }

  return store
}

async function performNativeSearch(
  tableRef: Table,
  vector: number[],
  searchLimit: number,
  whereClause?: string
): Promise<LanceDBSearchResult[]> {
  let searchQuery = tableRef.search(vector) as unknown as LanceDBSearchQuery

  if (whereClause) {
    try {
      if (searchQuery.where && typeof searchQuery.where === 'function') {
        searchQuery = searchQuery.where(whereClause)
      }
    } catch (whereError) {
      logWarn('Where clause not supported', 'Search', undefined, whereError as Error)
    }
  }

  const refineFactor = searchLimit > 200 ? 2 : 1
  try {
    if (searchQuery.refineFactor && typeof searchQuery.refineFactor === 'function') {
      searchQuery = searchQuery.refineFactor(refineFactor)
    }
  } catch {
    // refineFactor 可能不支持
  }

  return await searchQuery.limit(searchLimit).toArray()
}

async function getQueryVector(query: string, embeddings: Embeddings): Promise<number[]> {
  const cached = queryEmbeddingCache.get(query)
  if (cached) return cached
  const vec = await embeddings.embedQuery(query)
  queryEmbeddingCache.set(query, vec)
  return vec
}

async function performCrossLanguageSearch(
  tableRef: Table,
  query: string,
  embeddings: Embeddings,
  fetchK: number,
  whereClause?: string
): Promise<LanceDBSearchResult[]> {
  const { detectLanguage, generateCrossLanguageQueries } = await import('../queryTranslator')
  const queryLang = detectLanguage(query)

  if (queryLang !== 'zh') {
    const queryVector = await getQueryVector(query, embeddings)
    return await performNativeSearch(tableRef, queryVector, fetchK, whereClause)
  }

  logDebug('Detected Chinese query, attempting cross-language search', 'Search')

  try {
    const { queries } = await generateCrossLanguageQueries(query)
    const rrfK = RAG_CONFIG.CROSS_LANGUAGE.RRF_K

    const searchPromises = queries.map(async (q, index) => {
      const vector = await getQueryVector(q, embeddings)
      const results = await performNativeSearch(tableRef, vector, fetchK, whereClause)
      logDebug(`Query variant ${index + 1} got ${results.length} results`, 'Search', {
        queryPreview: q.slice(0, 30)
      })
      return results
    })

    const allResultLists = await Promise.all(searchPromises)

    const getResultKey = (r: LanceDBSearchResult): string => {
      return r.text || r.pageContent || JSON.stringify(r.metadata?.source || '')
    }

    const rrfResults = reciprocalRankFusion(allResultLists, getResultKey, rrfK)

    logDebug('RRF fusion completed', 'Search', {
      inputLists: allResultLists.length,
      totalBeforeFusion: allResultLists.reduce((sum, list) => sum + list.length, 0),
      afterFusion: rrfResults.length
    })

    return rrfResults.slice(0, fetchK).map(({ item, score }) => ({
      ...item,
      _distance: 1 / (score + 1)
    }))
  } catch (error) {
    logWarn(
      'Cross-language search failed, using original query',
      'Search',
      undefined,
      error as Error
    )
    const queryVector = await getQueryVector(query, embeddings)
    return await performNativeSearch(tableRef, queryVector, fetchK, whereClause)
  }
}

function convertToScoredDocuments(searchResults: LanceDBSearchResult[]): DocumentWithDistance[] {
  return searchResults
    .map((row) => {
      const distance = row._distance ?? 0
      const doc = new Document({
        pageContent: row.text || row.pageContent || '',
        metadata: {
          source: row.source || row.metadata?.source,
          pageNumber: row.pageNumber || row.metadata?.pageNumber,
          ...row.metadata
        }
      })
      return { doc, distance }
    })
    .sort((a, b) => a.distance - b.distance)
}

async function fallbackToLangChainSearch(
  query: string,
  k: number,
  sources?: string[]
): Promise<ScoredDocument[]> {
  if (!vectorStore) return []

  logDebug('Falling back to LangChain similaritySearch', 'Search')

  try {
    const isGlobalSearch = !sources || sources.length === 0
    const docCount = await getDocCountCached()
    const fetchK = calculateFetchK(k, docCount, isGlobalSearch)

    const docs = await vectorStore.similaritySearch(query, fetchK)

    let filteredDocs = docs
    if (sources && sources.length > 0) {
      filteredDocs = docs.filter((doc) => {
        const docSource = doc.metadata?.source ? normalizePath(String(doc.metadata.source)) : ''
        const sourceSet = new Set(sources.map((s) => normalizePath(s)))
        if (sourceSet.has(docSource)) return true
        if (sourceSet.size < 50) {
          for (const s of sourceSet) {
            if (docSource.endsWith(s) || s.endsWith(docSource)) return true
          }
        }
        return false
      })
    }

    return filteredDocs.slice(0, k).map((doc, i) => ({
      doc,
      score: 1 - i / Math.max(filteredDocs.length, 1)
    }))
  } catch (fallbackError) {
    logError('Fallback search also failed', 'Search', undefined, fallbackError as Error)
    return []
  }
}

// ==================== 公开 API ====================

export async function initVectorStore(): Promise<void> {
  if (vectorStore) return

  const dbPath = getDbPath()
  logInfo('Initializing LanceDB', 'VectorStore', { dbPath })

  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true })
  }

  try {
    await loadLanceModules()
    db = await connectFn!(dbPath)

    const conn = db as Connection
    const tableNames = await conn.tableNames()

    if (tableNames.includes(TABLE_NAME)) {
      try {
        table = await conn.openTable(TABLE_NAME)
        const embeddings = getEmbeddings()
        vectorStore = new LanceDBCtor!(embeddings, { table })
        logInfo('Opened existing LanceDB table', 'VectorStore')
      } catch (tableError) {
        logWarn(
          'Failed to open existing table, may need rebuild',
          'VectorStore',
          undefined,
          tableError as Error
        )
        vectorStore = null
        table = null
      }
    } else {
      vectorStore = null
      logInfo('LanceDB table does not exist, will be created on first document add', 'VectorStore')
    }
  } catch (error) {
    logWarn('Failed to connect to LanceDB', 'VectorStore', undefined, error as Error)
    db = null
    vectorStore = null
    table = null
  }
}

export async function getVectorStore(): Promise<LanceDB> {
  if (!vectorStore) {
    await initVectorStore()
  }
  if (!vectorStore) {
    throw new Error('Vector store not initialized. Please add documents first.')
  }
  return vectorStore
}

export async function addDocumentsToStore(
  docs: Document[],
  onProgress?: ProgressCallback,
  startProgress: number = 0,
  appendMode: boolean = true // 默认追加模式
): Promise<void> {
  if (docs.length === 0) return

  memoryMonitor.checkMemoryThreshold()

  const progressRange = 100 - startProgress
  const progressMsg = createProcessingProgress(
    TaskType.INDEX_REBUILD,
    startProgress,
    '正在索引文档...'
  )
  onProgress?.(progressMsg)

  // 确保 vectorStore 已初始化（用于追加模式）
  if (appendMode && !vectorStore) {
    await initVectorStore()
  }

  const embeddings = getEmbeddings()
  if (embeddings instanceof LocalEmbeddings) {
    embeddings.setTempProgressCallback((progress) => {
      if (progress.status === ProgressStatus.DOWNLOADING) {
        onProgress?.({
          ...progress,
          taskType: progress.taskType || TaskType.MODEL_DOWNLOAD
        })
      } else if (progress.status === ProgressStatus.PROCESSING && progress.progress !== undefined) {
        const adjustedProgress = Math.round(
          startProgress + (progress.progress / 100) * progressRange
        )
        onProgress?.(
          createProcessingProgress(
            TaskType.EMBEDDING_GENERATION,
            adjustedProgress,
            `正在生成向量 ${adjustedProgress}%`
          )
        )
      } else {
        onProgress?.(progress)
      }
    })
  }

  try {
    vectorStore = await ensureTableWithDocuments(docs, appendMode)
    onProgress?.(createCompletedMessage(TaskType.INDEX_REBUILD, '索引完成'))
    logInfo(`Added ${docs.length} documents to LanceDB`, 'VectorStore')
    invalidateDocCountCache()
    clearBM25Cache() // 清除 BM25 缓存以便重建
  } catch (error) {
    logError(
      'Failed to add documents, trying to recreate table',
      'VectorStore',
      undefined,
      error as Error
    )
    await resetVectorStore()
    vectorStore = await ensureTableWithDocuments(docs, false) // 重建时不使用追加模式
    onProgress?.(createCompletedMessage(TaskType.INDEX_REBUILD, '索引完成（已重建）'))
    logInfo(`Recreated LanceDB table and added ${docs.length} documents`, 'VectorStore')
    invalidateDocCountCache()
  } finally {
    if (embeddings instanceof LocalEmbeddings) {
      embeddings.setTempProgressCallback(undefined)
    }
  }
}

export async function searchSimilarDocumentsWithScores(
  query: string,
  options: SearchOptions = {}
): Promise<ScoredDocument[]> {
  const searchStart = Date.now()
  const { k = 4, sources } = options
  const metrics: Record<string, number | string> = {}

  // 增加调试日志
  console.log('[Search] Starting search with query:', query.slice(0, 50))
  console.log('[Search] Options:', { k, sourcesCount: sources?.length ?? 0 })

  logDebug('Starting search', 'Search', {
    query: query.slice(0, 50),
    sourcesCount: sources?.length ?? 0
  })

  await initVectorStore()

  if (!vectorStore || !table) {
    console.log('[Search] ERROR: vectorStore or table is null!')
    logWarn('vectorStore or table is null, returning empty', 'Search')
    return []
  }

  const docCount = await getDocCountCached()
  console.log('[Search] Document count in store:', docCount)

  const isGlobalSearch = !sources || sources.length === 0
  const complexity = estimateQueryComplexity(query)
  const intent = classifyQueryIntent(query)

  // 获取设置
  const settings = getSettings()
  const maxSearchLimit = settings.rag?.maxSearchLimit ?? RAG_CONFIG.SEARCH.MAX_K
  const defaultSearchLimit = settings.rag?.searchLimit ?? RAG_CONFIG.SEARCH.DEFAULT_K

  let baseK = k
  if (intent === 'definition') baseK = Math.max(3, Math.round(k * 0.8))
  if (intent === 'summary') baseK = Math.round(k * 1.5)
  if (intent === 'comparison') baseK = Math.round(k * 1.6)

  const adaptiveK = Math.min(
    maxSearchLimit,
    Math.max(baseK, Math.round(baseK + complexity * defaultSearchLimit))
  )
  const fetchK = Math.round(
    calculateFetchK(adaptiveK, docCount, isGlobalSearch) * (1 + complexity * 0.5)
  )

  metrics.fetchK = fetchK
  metrics.docCount = docCount
  metrics.complexity = Number(complexity.toFixed(2))
  metrics.intent = intent

  logDebug('Search parameters', 'Search', {
    fetchK,
    docCount,
    isGlobalSearch,
    query,
    complexity,
    adaptiveK,
    intent
  })

  try {
    const whereClause = sources && sources.length > 0 ? buildSourceWhereClause(sources) : undefined

    // 0. 获取所有文档用于 BM25 搜索（仅全库搜索时）
    let allDocsForBM25: LanceDBSearchResult[] = []
    if (isGlobalSearch) {
      try {
        allDocsForBM25 = (await table.query().limit(5000).toArray()) as LanceDBSearchResult[]
        logDebug('Loaded docs for BM25', 'Search', { count: allDocsForBM25.length })
      } catch (e) {
        logWarn('Failed to load docs for BM25', 'Search', undefined, e as Error)
      }
    }

    // 1. BM25 关键词搜索（与向量搜索并行）
    let bm25Results: LanceDBSearchResult[] = []
    const bm25Start = Date.now()
    if (isGlobalSearch && allDocsForBM25.length > 0) {
      try {
        const bm25Searcher = await getBM25Searcher(allDocsForBM25)

        // 提取查询关键词变体
        const keywords = extractFileNameKeywords(query)
        const queryVariants = [query, ...keywords.slice(0, 3)]

        const bm25SearchResults = bm25Searcher.searchMultiple(queryVariants, fetchK)
        bm25Results = bm25SearchResults.map(({ result, score }) => ({
          ...result,
          _distance: 1 / (score + 1), // 转换为距离格式
          _bm25Score: score
        }))

        logDebug('BM25 search completed', 'Search', {
          resultCount: bm25Results.length,
          topScore: bm25SearchResults[0]?.score?.toFixed(3) ?? 'N/A'
        })
      } catch (e) {
        logWarn('BM25 search failed', 'Search', undefined, e as Error)
      }
    }
    metrics.bm25SearchMs = Date.now() - bm25Start

    // 2. 文件名匹配搜索
    let fileNameMatches: LanceDBSearchResult[] = []
    if (isGlobalSearch) {
      const fnStart = Date.now()
      const fnResult = await searchByFileName(table, query, fetchK)
      fileNameMatches = fnResult.results
      metrics.fileNameSearchMs = Date.now() - fnStart
    }

    // 3. 跨语言向量搜索
    const vectorSearchStart = Date.now()
    const embeddings = getEmbeddings()
    const searchResults = await performCrossLanguageSearch(
      table,
      query,
      embeddings,
      fetchK,
      whereClause
    )
    metrics.vectorSearchMs = Date.now() - vectorSearchStart

    logDebug('Native search completed', 'Search', {
      resultCount: searchResults.length,
      fileNameMatchCount: fileNameMatches.length,
      bm25ResultCount: bm25Results.length
    })

    // 4. 使用 RRF 融合所有结果
    const getResultKey = (r: LanceDBSearchResult): string => {
      return r.text || r.pageContent || JSON.stringify(r.metadata?.source || '')
    }

    // 准备多个结果列表用于 RRF 融合
    const resultLists: LanceDBSearchResult[][] = []

    // 向量搜索结果（主要来源）
    if (searchResults.length > 0) {
      resultLists.push(searchResults)
    }

    // BM25 关键词搜索结果
    if (bm25Results.length > 0) {
      resultLists.push(bm25Results)
    }

    // 文件名匹配结果（高优先级）
    if (fileNameMatches.length > 0) {
      // 文件名匹配添加两次以增加权重
      resultLists.push(fileNameMatches)
      resultLists.push(fileNameMatches)
    }

    let mergedResults: LanceDBSearchResult[] = []

    if (resultLists.length > 1) {
      // 使用 RRF 融合多个结果列表
      const rrfResults = reciprocalRankFusion(
        resultLists,
        getResultKey,
        RAG_CONFIG.CROSS_LANGUAGE.RRF_K
      )

      // 计算 RRF 分数的最大值用于归一化
      const maxRrfScore = rrfResults.length > 0 ? rrfResults[0].score : 1
      const minRrfScore = rrfResults.length > 0 ? rrfResults[rrfResults.length - 1].score : 0
      const scoreRange = maxRrfScore - minRrfScore || 1

      mergedResults = rrfResults.slice(0, fetchK).map(({ item, score }) => {
        // 将 RRF 分数归一化到 [0, 1]，然后转换为距离
        // 分数越高 -> 距离越小
        const normalizedScore = (score - minRrfScore) / scoreRange
        // 映射到 [0, 0.8] 范围的距离（保证最高分得到高相似度）
        const distance = (1 - normalizedScore) * 0.8
        return {
          ...item,
          _distance: distance,
          _rrfScore: score // 保存原始 RRF 分数用于调试
        }
      })

      logDebug('RRF fusion of all search results', 'Search', {
        inputLists: resultLists.length,
        outputCount: mergedResults.length,
        maxRrfScore: maxRrfScore.toFixed(4),
        minRrfScore: minRrfScore.toFixed(4)
      })
    } else if (resultLists.length === 1) {
      mergedResults = resultLists[0]
    }

    if (mergedResults.length === 0) {
      logWarn('No search results found', 'Search', { query })
      return []
    }

    let scoredDocs = convertToScoredDocuments(mergedResults)

    if (sources && sources.length > 0) {
      const beforeCount = scoredDocs.length
      scoredDocs = filterResultsBySource(scoredDocs, sources)
      if (scoredDocs.length < beforeCount) {
        logDebug('Post-filter applied', 'Search', { before: beforeCount, after: scoredDocs.length })
      }
    }

    if (scoredDocs.length === 0) {
      return []
    }

    let finalResultsRaw = scoredDocs.map((r) => ({
      doc: r.doc,
      score: distanceToScore(r.distance)
    }))

    // 4. 相关性阈值过滤（支持用户配置）
    const relevanceFilterStart = Date.now()
    const beforeRelevanceFilter = finalResultsRaw.length
    const minRelevance = settings.rag?.minRelevance ?? RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD
    finalResultsRaw = filterByRelevanceThreshold(finalResultsRaw, query, minRelevance)
    metrics.relevanceFilterMs = Date.now() - relevanceFilterStart

    if (finalResultsRaw.length === 0) {
      logWarn('All results filtered by relevance threshold', 'Search', {
        query: query.slice(0, 50),
        originalCount: beforeRelevanceFilter
      })
      return []
    }

    let finalResults = finalResultsRaw

    // 5. MMR 重排序
    const mmrEnabled = RAG_CONFIG.SEARCH.MMR_ENABLED
    const mmrLambda = RAG_CONFIG.SEARCH.MMR_LAMBDA

    if (mmrEnabled && finalResultsRaw.length > adaptiveK) {
      const mmrStart = Date.now()

      if (intent === 'summary' || intent === 'comparison') {
        finalResults = mmrRerankByContent(finalResultsRaw, adaptiveK, mmrLambda - 0.1)
      } else {
        finalResults = mmrRerankByContent(finalResultsRaw, adaptiveK, mmrLambda)
      }

      metrics.mmrMs = Date.now() - mmrStart
    } else if (intent === 'summary' || intent === 'comparison') {
      finalResults = diversifyBySource(finalResultsRaw, adaptiveK)
    }

    const elapsed = Date.now() - searchStart
    metrics.totalMs = elapsed

    const cacheStats = queryEmbeddingCache.getStats()

    logDebug('Search completed', 'Search', {
      resultCount: Math.min(finalResults.length, k),
      topScore: finalResults[0]?.score.toFixed(3),
      sources: [
        ...new Set(
          finalResults
            .slice(0, k)
            .map((r) => r.doc.metadata?.source)
            .filter(Boolean)
        )
      ],
      latencyMs: elapsed,
      cacheHitRate: cacheStats.hitRate.toFixed(2)
    })

    if (RAG_CONFIG.METRICS.ENABLED && elapsed > RAG_CONFIG.METRICS.LOG_SLOW_QUERY_MS) {
      logWarn('Slow search detected', 'Search', {
        query: query.slice(0, 30),
        latencyMs: elapsed,
        metrics
      })
    }

    return finalResults.slice(0, k)
  } catch (e) {
    logError('Native search failed', 'Search', undefined, e as Error)
    return await fallbackToLangChainSearch(query, k, sources)
  }
}

export async function searchSimilarDocuments(
  query: string,
  options: SearchOptions = {}
): Promise<Document[]> {
  const results = await searchSimilarDocumentsWithScores(query, options)
  return results.map((r) => r.doc)
}

export async function getDocCount(): Promise<number> {
  return getDocCountCached()
}

export function invalidateDocCountCache(): void {
  cachedDocCount = null
  docCountCacheTime = 0
}

export async function closeVectorStore(): Promise<void> {
  vectorStore = null
  table = null
  db = null
  invalidateDocCountCache()
}

export async function resetVectorStore(): Promise<void> {
  const dbPath = getDbPath()
  await closeVectorStore()
  if (fs.existsSync(dbPath)) {
    await fsPromises.rm(dbPath, { recursive: true, force: true })
  }
}

export async function removeSourceFromStore(source: string): Promise<void> {
  await initVectorStore()
  if (!db) {
    logWarn('Database not initialized, cannot remove source', 'VectorStore', { source })
    return
  }

  const conn = db as Connection
  if (!table) {
    const names = await conn.tableNames()
    if (!names.includes(TABLE_NAME)) {
      logInfo('Table does not exist, nothing to remove', 'VectorStore', { source })
      return
    }
    table = await conn.openTable(TABLE_NAME)
  }

  // 生成多种路径变体以处理不同的存储格式
  const normalizedSource = normalizePath(source)
  const forwardSlash = source.replace(/\\/g, '/')
  const backSlash = source.replace(/\//g, '\\')
  const pathNormalized = path.normalize(source)

  // 同时尝试保持原大小写和小写版本
  const sourceVariants = [
    source, // 原始路径
    normalizedSource, // 小写 + 正斜杠
    forwardSlash, // 正斜杠（保持大小写）
    backSlash, // 反斜杠（保持大小写）
    pathNormalized, // path.normalize 结果
    forwardSlash.toLowerCase(), // 小写 + 正斜杠
    backSlash.toLowerCase() // 小写 + 反斜杠
  ]

  const uniqueVariants = [...new Set(sourceVariants)]

  logInfo('Removing source from vector store', 'VectorStore', {
    originalSource: source,
    normalizedSource,
    variantsCount: uniqueVariants.length
  })

  let successfulDeletes = 0
  let lastError: Error | null = null

  // LanceDB 表结构中实际存在的字段: source (路径存储在这里)
  // 注意: fileName 字段存储的是文件名，不是完整路径
  for (const variant of uniqueVariants) {
    const escapedVariant = escapePredicateValue(variant)

    // 只使用 source 字段进行删除（这是存储完整路径的字段）
    const predicate = `source == "${escapedVariant}"`

    try {
      await (table as unknown as { delete: (where: string) => Promise<void> }).delete(predicate)
      successfulDeletes++
      logDebug('Delete executed with predicate', 'VectorStore', { predicate })
    } catch (e) {
      lastError = e as Error
      const errMsg = String(e)
      // 忽略 "no rows affected" 类型的错误
      if (!errMsg.includes('no rows') && !errMsg.includes('not found')) {
        logDebug('Delete failed with predicate', 'VectorStore', { predicate, error: errMsg })
      }
    }
  }

  invalidateDocCountCache()
  clearBM25Cache()

  logInfo('Source removal completed', 'VectorStore', {
    source,
    successfulDeletes,
    lastError: lastError?.message
  })
}

export async function removeSourcesFromStore(sources: string[]): Promise<void> {
  if (sources.length === 0) return

  logInfo(`Removing ${sources.length} sources from vector store`, 'VectorStore', {
    sources: sources.slice(0, 5) // 只记录前5个，避免日志过长
  })

  await initVectorStore()
  if (!db || !table) {
    logWarn('Database or table not initialized, falling back to individual removal', 'VectorStore')
    for (const source of sources) {
      await removeSourceFromStore(source)
    }
    return
  }

  // 尝试批量删除（更高效）
  try {
    // 构建所有路径变体
    const allVariants: string[] = []
    for (const source of sources) {
      const normalizedSource = normalizePath(source)
      const forwardSlash = source.replace(/\\/g, '/')
      allVariants.push(source, normalizedSource, forwardSlash)
    }
    const uniqueVariants = [...new Set(allVariants)]
    const escapedVariants = uniqueVariants.map((v) => `"${escapePredicateValue(v)}"`)

    // 只使用 source 字段进行批量删除（这是存储完整路径的字段）
    const inClause = escapedVariants.join(', ')
    const batchPredicate = `source IN (${inClause})`

    logDebug('Executing batch delete', 'VectorStore', {
      variantCount: uniqueVariants.length,
      predicateLength: batchPredicate.length
    })

    await (table as unknown as { delete: (where: string) => Promise<void> }).delete(batchPredicate)

    invalidateDocCountCache()
    clearBM25Cache()

    logInfo('Batch delete completed successfully', 'VectorStore', { sourceCount: sources.length })
    return
  } catch (batchError) {
    logWarn(
      'Batch delete failed, falling back to individual removal',
      'VectorStore',
      undefined,
      batchError as Error
    )
  }

  // 回退：逐个删除
  for (const source of sources) {
    try {
      await removeSourceFromStore(source)
    } catch (e) {
      logWarn('Failed to remove source', 'VectorStore', { source }, e as Error)
    }
  }

  // 确保缓存被清理
  invalidateDocCountCache()
  clearBM25Cache()
}

export async function clearEmbeddingsCache(): Promise<void> {
  await clearEmbeddingsInternal()
  vectorStore = null
  table = null
  db = null
  queryEmbeddingCache.clear()
  clearBM25Cache()
  console.log(
    'Embeddings, vector store, query cache, BM25 index, and database connection cache cleared'
  )
}

export async function getVectorStoreStats(): Promise<VectorStoreStats> {
  const dbPath = getDbPath()

  // 强制刷新文档数量（不使用缓存）
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

  // 获取知识库文件记录数量（用于对比）
  let knowledgeBaseFileCount = 0
  try {
    const { getIndexedFileRecords } = await import('../knowledgeBase')
    knowledgeBaseFileCount = getIndexedFileRecords().length
  } catch (e) {
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

export function pruneExpiredCaches(): { pruned: number } {
  const pruned = queryEmbeddingCache.prune()
  if (pruned > 0) {
    logDebug('Pruned expired cache entries', 'VectorStore', { pruned })
  }
  return { pruned }
}

export function getQueryCacheStats() {
  return queryEmbeddingCache.getStats()
}
