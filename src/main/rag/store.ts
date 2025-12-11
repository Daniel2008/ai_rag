import type { LanceDB } from '@langchain/community/vectorstores/lancedb'
import type { Connection, Table } from '@lancedb/lancedb'
import { OllamaEmbeddings } from '@langchain/ollama'
import { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import { app, BrowserWindow } from 'electron'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { getSettings } from '../settings'
import {
  LocalEmbeddings,
  setProgressCallback,
  type LocalEmbeddingModelName,
  type ModelProgressCallback
} from './localEmbeddings'
import { ProgressStatus, ProgressMessage, TaskType } from './progressTypes'
import { RAG_CONFIG } from '../utils/config'
import { logDebug, logInfo, logWarn, logError } from '../utils/logger'
import { memoryMonitor } from '../utils/memoryMonitor'
import { createProcessingProgress, createCompletedMessage } from '../utils/progressHelper'

// ==================== 公共工具函数 ====================

/**
 * 标准化路径格式（统一小写和斜杠）
 */
function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\\/g, '/').trim()
}

/**
 * 转义谓词值中的特殊字符
 */
function escapePredicateValue(value: string): string {
  return value.replace(/"/g, '\\"')
}

/**
 * 计算最优检索数量 fetchK
 */
function calculateFetchK(k: number, docCount: number, isGlobalSearch: boolean): number {
  const { SEARCH } = RAG_CONFIG
  const baseFetchK = isGlobalSearch
    ? Math.max(
        k * SEARCH.GLOBAL_SEARCH_MULTIPLIER,
        Math.min(
          SEARCH.MAX_FETCH_K,
          Math.max(SEARCH.MIN_FETCH_K, Math.floor(docCount * SEARCH.GLOBAL_SEARCH_RATIO))
        )
      )
    : Math.max(k * SEARCH.FILTERED_SEARCH_MULTIPLIER, SEARCH.MIN_FETCH_K)
  return Math.max(baseFetchK, k * 10)
}

/**
 * 按来源过滤文档结果
 */
function filterResultsBySource<T extends { doc: Document }>(
  results: T[],
  sources: string[]
): T[] {
  if (!sources || sources.length === 0) return results
  
  const sourceSet = new Set(sources.map((s) => normalizePath(s)))
  
  return results.filter(({ doc }) => {
    const docSource = doc.metadata?.source ? normalizePath(String(doc.metadata.source)) : ''
    if (sourceSet.has(docSource)) return true
    // 模糊匹配：处理路径格式差异
    if (sourceSet.size < 50) {
      for (const s of sourceSet) {
        if (docSource.endsWith(s) || s.endsWith(docSource)) return true
      }
    }
    return false
  })
}

// ==================== 搜索结果类型定义 ====================

/**
 * LanceDB 原生搜索结果类型
 */
interface LanceDBSearchResult {
  text?: string
  pageContent?: string
  source?: string
  pageNumber?: number
  metadata?: {
    source?: string
    pageNumber?: number
    [key: string]: unknown
  }
  _distance?: number
  _queryIndex?: number
}

/**
 * LanceDB 搜索查询接口
 */
interface LanceDBSearchQuery {
  where?: (clause: string) => LanceDBSearchQuery
  refineFactor?: (factor: number) => LanceDBSearchQuery
  limit: (n: number) => { toArray: () => Promise<LanceDBSearchResult[]> }
}

// ==================== 模块级变量 ====================

// Singleton instances
let db: Connection | null = null
let table: Table | null = null
let vectorStore: LanceDB | null = null
let LanceDBCtor: typeof import('@langchain/community/vectorstores/lancedb').LanceDB | null = null
let connectFn: typeof import('@lancedb/lancedb').connect | null = null

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

// 性能优化：缓存 Embeddings 实例
let cachedEmbeddings: Embeddings | null = null
let cachedEmbeddingsConfig: { provider: string; model: string; baseUrl?: string } | null = null
// 并发控制：防止多个并发请求同时初始化
let embeddingsInitPromise: Promise<Embeddings> | null = null
// 进度抑制计数，避免聊天触发全局进度条
let embeddingProgressSuppressionCount = 0

function isEmbeddingProgressSuppressed(): boolean {
  return embeddingProgressSuppressionCount > 0
}

export async function withEmbeddingProgressSuppressed<T>(fn: () => Promise<T>): Promise<T> {
  embeddingProgressSuppressionCount++
  try {
    return await fn()
  } finally {
    embeddingProgressSuppressionCount = Math.max(0, embeddingProgressSuppressionCount - 1)
  }
}

export function setEmbeddingProgressSuppressed(suppressed: boolean): void {
  embeddingProgressSuppressionCount = Math.max(0, suppressed ? embeddingProgressSuppressionCount + 1 : embeddingProgressSuppressionCount - 1)
}

const TABLE_NAME = 'documents'

function getDbPath(): string {
  // 兼容非Electron环境
  if (app?.getPath) {
    return path.join(app.getPath('userData'), 'lancedb')
  } else {
    // 在非Electron环境下使用当前目录
    return path.join(process.cwd(), '.lancedb')
  }
}

// 发送嵌入模型进度到渲染进程
function sendEmbeddingProgress(progress: Parameters<ModelProgressCallback>[0]): void {
  if (isEmbeddingProgressSuppressed()) {
    return
  }

  // 兼容非Electron环境
  if (BrowserWindow?.getAllWindows) {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('embedding:progress', progress)
    })
  } else {
    // 在非Electron环境下打印进度
    logInfo('Embedding progress', 'EmbeddingProgress', { status: progress.status, message: progress.message, progress: progress.progress })
  }
}

// 性能优化：缓存 Embeddings 实例，只在配置变化时重新创建
// 线程安全：使用 Promise 确保并发请求共享同一个初始化过程
function getEmbeddings(): Embeddings {
  const settings = getSettings()
  const currentConfig = {
    provider: settings.embeddingProvider,
    model: settings.embeddingModel,
    baseUrl: settings.ollamaUrl
  }

  // 检查配置是否变化
  if (
    cachedEmbeddings &&
    cachedEmbeddingsConfig &&
    cachedEmbeddingsConfig.provider === currentConfig.provider &&
    cachedEmbeddingsConfig.model === currentConfig.model &&
    cachedEmbeddingsConfig.baseUrl === currentConfig.baseUrl
  ) {
    return cachedEmbeddings
  }

  // 如果正在初始化且配置未变化，等待初始化完成
  if (embeddingsInitPromise) {
    // 注意：这里不能直接返回 Promise，需要同步返回 Embeddings
    // 但如果配置变了，应该重新初始化
    embeddingsInitPromise = null
  }

  // 根据提供者创建不同的嵌入实例
  if (currentConfig.provider === 'local') {
    // 使用本地嵌入模型，设置全局进度回调
    setProgressCallback(sendEmbeddingProgress)
    cachedEmbeddings = new LocalEmbeddings({
      modelName: currentConfig.model as LocalEmbeddingModelName,
      onProgress: sendEmbeddingProgress
    })
  } else {
    // 使用 Ollama 嵌入模型
    cachedEmbeddings = new OllamaEmbeddings({
      model: currentConfig.model,
      baseUrl: currentConfig.baseUrl
    })
  }

  cachedEmbeddingsConfig = currentConfig
  return cachedEmbeddings
}

/**
 * 确保嵌入模型已初始化（如果需要下载模型，将触发进度回调）
 */
export async function ensureEmbeddingsInitialized(
  onProgress?: ProgressCallback
): Promise<void> {
  const embeddings = getEmbeddings()
  
  if (embeddings instanceof LocalEmbeddings) {
    if (onProgress) {
      // 临时接管进度回调
      embeddings.setTempProgressCallback((progress) => {
        // 只转发模型下载相关的进度，或者初始化过程中的信息
        if (progress.taskType === TaskType.MODEL_DOWNLOAD || progress.status === ProgressStatus.DOWNLOADING) {
          onProgress(progress)
        } else if (progress.status === ProgressStatus.PROCESSING) {
          // 初始化时的处理状态
          onProgress(progress)
        }
      })
    }
    
    try {
      await embeddings.initialize()
    } finally {
      // 清理临时回调
      if (onProgress) {
        embeddings.setTempProgressCallback(undefined)
      }
    }
  }
}

export async function initVectorStore(): Promise<void> {
  if (vectorStore) return

  const dbPath = getDbPath()
  logInfo('Initializing LanceDB', 'VectorStore', { dbPath })

  // Ensure directory exists
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true })
  }

  try {
    await loadLanceModules()
    db = await connectFn!(dbPath)

    // Check if table exists
    const conn = db as Connection
    const tableNames = await conn.tableNames()

    if (tableNames.includes(TABLE_NAME)) {
      // Open existing table
      try {
        table = await conn.openTable(TABLE_NAME)
        const embeddings = getEmbeddings()
        vectorStore = new LanceDBCtor!(embeddings, { table })
        logInfo('Opened existing LanceDB table', 'VectorStore')
      } catch (tableError) {
        // 表打开失败，可能是因为嵌入模型维度不匹配，标记为需要重建
        logWarn('Failed to open existing table, may need rebuild', 'VectorStore', undefined, tableError as Error)
        vectorStore = null
        table = null
      }
    } else {
      // 表不存在时，我们不立即创建，而是标记需要在添加文档时创建
      // 设置一个空的 vectorStore 标记，让 addDocumentsToStore 负责创建
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

// 确保表存在，如果不存在则用初始文档创建
async function ensureTableWithDocuments(docs: Document[]): Promise<LanceDB> {
  const dbPath = getDbPath()
  const embeddings = getEmbeddings()

  if (!db) {
    await loadLanceModules()
    db = await connectFn!(dbPath)
  }

  // 总是使用 fromDocuments 创建新表，这样可以确保表结构正确
  // 如果表已存在，LanceDB.fromDocuments 会添加到现有表
  logInfo('Creating/updating LanceDB table with documents', 'VectorStore')
  await loadLanceModules()
  const store = await LanceDBCtor!.fromDocuments(docs, embeddings, {
    uri: dbPath,
    tableName: TABLE_NAME
  })

  // 更新缓存的 table 引用
  const conn2 = db as Connection
  const tableNames = await conn2.tableNames()
  if (tableNames.includes(TABLE_NAME)) {
    table = await conn2.openTable(TABLE_NAME)
  }

  return store
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

/** 进度回调函数类型，使用统一的ProgressMessage格式 */
export type ProgressCallback = (message: ProgressMessage) => void

export async function addDocumentsToStore(
  docs: Document[],
  onProgress?: ProgressCallback,
  startProgress: number = 0
): Promise<void> {
  if (docs.length === 0) return

  // 检查内存使用
  memoryMonitor.checkMemoryThreshold()
  
  // 计算进度范围（默认0-100，接收起始进度后调整为startProgress-100）
  const progressRange = 100 - startProgress

  // 总是使用 ensureTableWithDocuments，它会处理表的创建或更新
  // 这样可以避免 vectorStore 指向无效表的问题
  const progressMsg = createProcessingProgress(
    TaskType.INDEX_REBUILD,
    startProgress,
    '正在索引文档...'
  )
  onProgress?.(progressMsg)

  // 尝试接管嵌入进度
  const embeddings = getEmbeddings()
  if (embeddings instanceof LocalEmbeddings) {
    embeddings.setTempProgressCallback((progress) => {
      if (progress.status === ProgressStatus.DOWNLOADING) {
        // 模型下载进度，保持原有消息格式，添加taskType
        onProgress?.({
          ...progress,
          taskType: progress.taskType || TaskType.MODEL_DOWNLOAD
        })
      } else if (progress.status === ProgressStatus.PROCESSING && progress.progress !== undefined) {
        // 向量生成进度，转换为相对于起始进度的百分比
        const adjustedProgress = Math.round(startProgress + (progress.progress / 100) * progressRange)
        onProgress?.(createProcessingProgress(
          TaskType.EMBEDDING_GENERATION,
          adjustedProgress,
          `正在生成向量 ${adjustedProgress}%`
        ))
      } else {
        // 其他进度类型直接传递
        onProgress?.(progress)
      }
    })
  }

  try {
    vectorStore = await ensureTableWithDocuments(docs)
    onProgress?.(createCompletedMessage(TaskType.INDEX_REBUILD, '索引完成'))
    logInfo(`Added ${docs.length} documents to LanceDB`, 'VectorStore')
    // 清除文档数量缓存
    invalidateDocCountCache()
  } catch (error) {
    logError('Failed to add documents, trying to recreate table', 'VectorStore', undefined, error as Error)
    // 如果失败，尝试重置并重新创建
    await resetVectorStore()
    vectorStore = await ensureTableWithDocuments(docs)
    onProgress?.(createCompletedMessage(TaskType.INDEX_REBUILD, '索引完成（已重建）'))
    logInfo(`Recreated LanceDB table and added ${docs.length} documents`, 'VectorStore')
    // 清除文档数量缓存
    invalidateDocCountCache()
  } finally {
    // 清理临时回调
    if (embeddings instanceof LocalEmbeddings) {
      embeddings.setTempProgressCallback(undefined)
    }
  }
}

export interface SearchOptions {
  k?: number
  sources?: string[]
}

// ==================== 核心搜索方法 ====================

// 缓存文档数量，避免重复查询
let cachedDocCount: number | null = null
let docCountCacheTime: number = 0
const DOC_COUNT_CACHE_TTL = RAG_CONFIG.DOC_COUNT_CACHE.TTL

async function getDocCountCached(): Promise<number> {
  const now = Date.now()
  if (cachedDocCount !== null && (now - docCountCacheTime) < DOC_COUNT_CACHE_TTL) {
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
    logWarn('[getDocCountCached] Failed to get doc count', 'VectorStore', undefined, e as Error)
    return cachedDocCount ?? 0
  }
}

/**
 * 清除文档数量缓存（在添加或删除文档后调用）
 */
export function invalidateDocCountCache(): void {
  cachedDocCount = null
  docCountCacheTime = 0
}

export async function getDocCount(): Promise<number> {
  // 使用缓存版本
  return getDocCountCached()
}

/**
 * 执行 LanceDB 原生向量搜索
 */
async function performNativeSearch(
  tableRef: Table,
  vector: number[],
  searchLimit: number,
  whereClause?: string
): Promise<LanceDBSearchResult[]> {
  let searchQuery = tableRef.search(vector) as unknown as LanceDBSearchQuery

  // 应用 where 子句（如果存在）
  if (whereClause) {
    try {
      if (searchQuery.where && typeof searchQuery.where === 'function') {
        searchQuery = searchQuery.where(whereClause)
      }
    } catch (whereError) {
      logWarn('Where clause not supported, will filter after search', 'Search', undefined, whereError as Error)
    }
  }

  // 根据检索数量动态调整 refineFactor
  const refineFactor = searchLimit > 200 ? 2 : 1
  try {
    if (searchQuery.refineFactor && typeof searchQuery.refineFactor === 'function') {
      searchQuery = searchQuery.refineFactor(refineFactor)
    }
  } catch {
    // refineFactor 可能不支持，忽略
  }

  return await searchQuery.limit(searchLimit).toArray()
}

/**
 * 构建来源过滤的 where 子句
 */
function buildSourceWhereClause(sources: string[]): string {
  const normalizedSources = sources.map((s) => normalizePath(s))
  const escapedSources = normalizedSources.map((s) => `"${escapePredicateValue(s)}"`)
  return `source IN (${escapedSources.join(', ')}) OR metadata.source IN (${escapedSources.join(', ')})`
}

/**
 * 执行跨语言搜索（中文查询时同时使用英文翻译）
 */
async function performCrossLanguageSearch(
  tableRef: Table,
  query: string,
  embeddings: Embeddings,
  fetchK: number,
  whereClause?: string
): Promise<LanceDBSearchResult[]> {
  const { detectLanguage, generateCrossLanguageQueries } = await import('./queryTranslator')
  const queryLang = detectLanguage(query)

  if (queryLang !== 'zh') {
    // 非中文查询，直接使用原查询
    const queryVector = await embeddings.embedQuery(query)
    return await performNativeSearch(tableRef, queryVector, fetchK, whereClause)
  }

  logDebug('Detected Chinese query, attempting cross-language search', 'Search')

  try {
    const { queries } = await generateCrossLanguageQueries(query)

    // 使用所有查询变体进行检索
    const searchPromises = queries.map(async (q, index) => {
      const vector = await embeddings.embedQuery(q)
      const results = await performNativeSearch(tableRef, vector, fetchK, whereClause)
      logDebug(`Query variant ${index + 1} got ${results.length} results`, 'Search')
      // 添加查询索引用于调试
      return results.map((r) => ({ ...r, _queryIndex: index } as LanceDBSearchResult))
    })

    const allResults = await Promise.all(searchPromises)
    let mergedResults: LanceDBSearchResult[] = allResults.flat()

    // 去重：基于文档内容，保留距离最小的
    const docMap = new Map<string, LanceDBSearchResult>()
    for (const result of mergedResults) {
      const docKey = result.text || result.pageContent || JSON.stringify(result.metadata?.source || '')
      const existing = docMap.get(docKey)
      if (!existing || (result._distance ?? Infinity) < (existing._distance ?? Infinity)) {
        docMap.set(docKey, result)
      }
    }
    mergedResults = Array.from(docMap.values())

    // 按距离排序并截取
    mergedResults.sort((a, b) => (a._distance ?? 0) - (b._distance ?? 0))
    return mergedResults.slice(0, fetchK)
  } catch (error) {
    logWarn('Cross-language search failed, using original query', 'Search', undefined, error as Error)
    const queryVector = await embeddings.embedQuery(query)
    return await performNativeSearch(tableRef, queryVector, fetchK, whereClause)
  }
}

/**
 * 将 LanceDB 搜索结果转换为带分数的文档
 */
function convertToScoredDocuments(
  searchResults: LanceDBSearchResult[]
): { doc: Document; distance: number }[] {
  return searchResults.map((row) => {
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
  }).sort((a, b) => a.distance - b.distance)
}

/**
 * 将距离转换为相似度分数 [0, 1]
 * 使用 1 / (1 + distance) 公式
 */
function distanceToScore(distance: number): number {
  return Math.max(0, Math.min(1, 1 / (1 + distance)))
}

/**
 * 从查询中提取可能的文件名关键词
 */
function extractFileNameKeywords(query: string): string[] {
  // 提取可能是文件名的中文关键词（书名、经典名称等）
  const chineseKeywords = query.match(/[\u4e00-\u9fa5]{2,}/g) || []
  return chineseKeywords.filter(kw => kw.length >= 2)
}

/**
 * 搜索文件名匹配的文档
 */
async function searchByFileName(
  tableRef: Table,
  query: string,
  limit: number
): Promise<LanceDBSearchResult[]> {
  const keywords = extractFileNameKeywords(query)
  if (keywords.length === 0) return []
  
  logDebug('Searching by filename keywords', 'Search', { keywords })
  
  try {
    // 直接查询表数据
    const allRows = await tableRef.query().limit(1000).toArray() as LanceDBSearchResult[]
    
    // 过滤包含关键词的文档
    const matchedRows = allRows.filter(row => {
      const source = row.source || row.metadata?.source || ''
      const text = row.text || row.pageContent || ''
      
      // 检查文件名是否包含关键词
      for (const kw of keywords) {
        if (source.includes(kw)) {
          return true
        }
      }
      
      // 如果文档内容开头包含关键词（可能是标题）
      if (text.slice(0, 200).includes(query)) {
        return true
      }
      
      return false
    })
    
    logDebug('Filename search found matches', 'Search', {
      matchCount: matchedRows.length,
      sources: [...new Set(matchedRows.map(r => r.source || r.metadata?.source).filter(Boolean))].slice(0, 5)
    })
    
    return matchedRows.slice(0, limit)
  } catch (e) {
    logDebug('Filename search failed', 'Search', { error: String(e) })
    return []
  }
}

/**
 * 统一的向量搜索函数（带分数）
 * 这是主要的搜索接口，其他场景应该基于此函数
 */
export async function searchSimilarDocumentsWithScores(
  query: string,
  options: SearchOptions = {}
): Promise<{ doc: Document; score: number }[]> {
  const { k = 4, sources } = options

  logDebug('Starting search', 'Search', { query: query.slice(0, 50), sourcesCount: sources?.length ?? 0 })

  await initVectorStore()

  if (!vectorStore || !table) {
    logWarn('vectorStore or table is null, returning empty', 'Search')
    return []
  }

  const docCount = await getDocCountCached()
  const isGlobalSearch = !sources || sources.length === 0
  const fetchK = calculateFetchK(k, docCount, isGlobalSearch)

  logDebug('Search parameters', 'Search', { fetchK, docCount, isGlobalSearch, query })

  try {
    // 构建 where 子句
    const whereClause = sources && sources.length > 0 ? buildSourceWhereClause(sources) : undefined
    if (whereClause) {
      logDebug('Using where clause for filtering', 'Search', { whereClause: whereClause.slice(0, 100) })
    }

    // 1. 先执行文件名匹配搜索（对于全库搜索）
    let fileNameMatches: LanceDBSearchResult[] = []
    if (isGlobalSearch) {
      fileNameMatches = await searchByFileName(table, query, fetchK)
    }

    // 2. 执行跨语言向量搜索
    const embeddings = getEmbeddings()
    const searchResults = await performCrossLanguageSearch(table, query, embeddings, fetchK, whereClause)

    logDebug('Native search completed', 'Search', {
      resultCount: searchResults.length,
      fileNameMatchCount: fileNameMatches.length
    })

    // 3. 合并结果：文件名匹配的结果优先
    let mergedResults: LanceDBSearchResult[] = []
    
    // 先添加文件名匹配的结果（给予高分加成）
    const fileNameSet = new Set<string>()
    if (fileNameMatches.length > 0) {
      for (const match of fileNameMatches) {
        const key = match.text || match.pageContent || JSON.stringify(match.metadata?.source || '')
        if (!fileNameSet.has(key)) {
          fileNameSet.add(key)
          // 文件名匹配的结果，设置较小的距离（更高的相关性）
          mergedResults.push({
            ...match,
            _distance: Math.min(match._distance ?? 0, 0.3) // 确保文件名匹配有较高分数
          })
        }
      }
      logDebug('Added filename matches', 'Search', { count: mergedResults.length })
    }
    
    // 再添加向量搜索的结果（去重）
    for (const result of searchResults) {
      const key = result.text || result.pageContent || JSON.stringify(result.metadata?.source || '')
      if (!fileNameSet.has(key)) {
        fileNameSet.add(key)
        mergedResults.push(result)
      }
    }

    if (mergedResults.length === 0) {
      logWarn('No search results found', 'Search', { query })
      return []
    }

    // 转换结果并排序
    let scoredDocs = convertToScoredDocuments(mergedResults)

    // 后置源过滤（如果 where 子句未生效）
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

    // 转换为最终分数格式
    const finalResults = scoredDocs.map((r) => ({
      doc: r.doc,
      score: distanceToScore(r.distance)
    }))

    logDebug('Search completed', 'Search', {
      resultCount: Math.min(finalResults.length, k),
      topScore: finalResults[0]?.score.toFixed(3),
      sources: [...new Set(finalResults.slice(0, k).map(r => r.doc.metadata?.source).filter(Boolean))]
    })

    return finalResults.slice(0, k)
  } catch (e) {
    logError('Native search failed', 'Search', undefined, e as Error)

    // Fallback 到 LangChain
    return await fallbackToLangChainSearch(query, k, sources)
  }
}

/**
 * LangChain 后备搜索
 */
async function fallbackToLangChainSearch(
  query: string,
  k: number,
  sources?: string[]
): Promise<{ doc: Document; score: number }[]> {
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

    // 使用排名生成伪分数
    return filteredDocs.slice(0, k).map((doc, i) => ({
      doc,
      score: 1 - i / Math.max(filteredDocs.length, 1)
    }))
  } catch (fallbackError) {
    logError('Fallback search also failed', 'Search', undefined, fallbackError as Error)
    return []
  }
}

/**
 * 搜索相似文档（不带分数）
 * 基于 searchSimilarDocumentsWithScores 实现
 */
export async function searchSimilarDocuments(
  query: string,
  options: SearchOptions = {}
): Promise<Document[]> {
  const results = await searchSimilarDocumentsWithScores(query, options)
  return results.map((r) => r.doc)
}

// Clean up function
export async function closeVectorStore(): Promise<void> {
  vectorStore = null
  table = null
  db = null
  cachedEmbeddings = null
  cachedEmbeddingsConfig = null
  embeddingsInitPromise = null
  // 清除文档数量缓存
  invalidateDocCountCache()
}

export async function resetVectorStore(): Promise<void> {
  const dbPath = getDbPath()
  await closeVectorStore()
  if (fs.existsSync(dbPath)) {
    await fsPromises.rm(dbPath, { recursive: true, force: true })
  }
}

/**
 * 从向量存储中删除指定来源的所有文档
 * @param source 文件路径或 URL
 */
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

  // 标准化路径以确保匹配
  const normalizedSource = normalizePath(source)
  const originalSource = source
  
  // 尝试多种路径格式和字段名（仅精确匹配，避免误删）
  const sourceVariants = [
    originalSource, // 原始路径
    normalizedSource, // 标准化路径
    originalSource.replace(/\\/g, '/'), // 统一斜杠
    path.normalize(originalSource) // 规范化路径
  ]
  
  // 去重
  const uniqueVariants = [...new Set(sourceVariants)]
  
  logInfo('Removing source from vector store', 'VectorStore', { 
    originalSource, 
    normalizedSource, 
    variantsCount: uniqueVariants.length 
  })

  let deletedCount = 0
  let lastError: Error | null = null

  // 对每个路径变体尝试删除
  for (const variant of uniqueVariants) {
    const escapedVariant = escapePredicateValue(variant)
    
    // 尝试多种字段名的精确匹配（不再使用 LIKE，避免误删）
    const predicates = [
      `source == "${escapedVariant}"`,
      `metadata.source == "${escapedVariant}"`,
      `path == "${escapedVariant}"`,
      `url == "${escapedVariant}"`
    ]

    for (const predicate of predicates) {
      try {
        await (table as unknown as { delete: (where: string) => Promise<void> }).delete(predicate)
        deletedCount++
        logDebug(`Deleted records with predicate`, 'VectorStore', { predicate })
      } catch (e) {
        // 记录错误但继续尝试其他谓词
        lastError = e as Error
        logDebug(`Delete failed with predicate`, 'VectorStore', { predicate, error: String(e) })
      }
    }
  }

  // 移除查询+模糊删除的兜底逻辑，防止误删全表

  // 清除文档数量缓存
  invalidateDocCountCache()

  if (deletedCount > 0) {
    logInfo(`Successfully removed source from vector store`, 'VectorStore', { source, deletedCount })
  } else {
    logWarn('No records deleted from vector store', 'VectorStore', { source, lastError: lastError?.message })
  }
}

/**
 * 批量删除多个来源
 */
export async function removeSourcesFromStore(sources: string[]): Promise<void> {
  logInfo(`Removing ${sources.length} sources from vector store`, 'VectorStore')
  for (const source of sources) {
    await removeSourceFromStore(source)
  }
}

/**
 * 清除嵌入模型缓存（用于设置变更后）
 * 注意：这会清除所有缓存，下次使用时会重新连接数据库
 * 如果切换了嵌入模型，旧的向量数据将不兼容，需要重新索引文档
 */
export async function clearEmbeddingsCache(): Promise<void> {
  // 清除嵌入实例缓存
  cachedEmbeddings = null
  cachedEmbeddingsConfig = null
  embeddingsInitPromise = null
  // 清除所有缓存，包括数据库连接
  vectorStore = null
  table = null
  db = null
  // 同时清除本地模型缓存
  const localEmbeddings = await import('./localEmbeddings')
  localEmbeddings.clearModelCache()
  console.log('Embeddings, vector store, and database connection cache cleared')
}
