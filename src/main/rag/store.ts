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
    // #region agent log
    void fetch('http://127.0.0.1:7242/ingest/fe103cf3-70ae-473a-91de-9a32e06f1764', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: 'debug-session',
        runId: 'pre-fix',
        hypothesisId: 'H5',
        location: 'store.ts:sendEmbeddingProgress',
        message: 'embedding progress suppressed',
        data: {
          status: progress.status,
          progress: progress.progress,
          taskType: progress.taskType
        },
        timestamp: Date.now()
      })
    }).catch(() => {})
    // #endregion
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

export async function searchSimilarDocumentsWithScores(
  query: string,
  options: SearchOptions = {}
): Promise<{ doc: Document; score: number }[]> {
  const { k = 4, sources } = options

  logDebug('Starting search', 'Search', { query: query.slice(0, 50), sourcesCount: sources?.length ?? 0 })

  await initVectorStore()
  logDebug('VectorStore initialized', 'Search', { hasVectorStore: !!vectorStore, hasTable: !!table })

  if (!vectorStore || !table) {
    logWarn('vectorStore or table is null, returning empty', 'Search')
    return []
  }

  // 动态计算检索数量：根据库大小和是否全库检索调整
  // 使用缓存避免重复查询
  const docCount = await getDocCountCached()
  logDebug('Total docs in DB', 'Search', { docCount })
  
  // 全库检索时，需要检索更多结果以确保命中率
  // 如果库很大，需要检索更多；如果指定了 sources，可以检索少一些
  const { SEARCH } = RAG_CONFIG
  const isGlobalSearch = !sources || sources.length === 0
  const baseFetchK = isGlobalSearch 
    ? Math.max(
        k * SEARCH.GLOBAL_SEARCH_MULTIPLIER, 
        Math.min(
          SEARCH.MAX_FETCH_K, 
          Math.max(
            SEARCH.MIN_FETCH_K, 
            Math.floor(docCount * SEARCH.GLOBAL_SEARCH_RATIO)
          )
        )
      )
    : Math.max(k * SEARCH.FILTERED_SEARCH_MULTIPLIER, SEARCH.MIN_FETCH_K)
  const fetchK = Math.max(baseFetchK, k * 10)  // 至少是 k 的 10 倍
  
  logDebug('Using search', 'Search', { fetchK, docCount, isGlobalSearch })

  try {
    // 直接使用原生 LanceDB API，因为 LangChain 的 similaritySearchWithScore 
    // 在当前版本中不返回有效的分数（返回 undefined）
    // 原生 API 可以正确返回 _distance 字段
    logDebug('Using native LanceDB API for accurate distance scores', 'Search')
    
    // 构建 where 子句进行元数据过滤（如果指定了 sources）
    // 参考 LanceDB 官方文档：使用 where 子句可以在查询时直接过滤，提高效率
    let whereClause: string | undefined
    if (sources && sources.length > 0) {
      const normalizePath = (p: string): string => p.toLowerCase().replace(/\\/g, '/').trim()
      const normalizedSources = sources.map((s) => normalizePath(s))
      
      // 构建 OR 条件：source == "path1" OR source == "path2" ...
      // 使用转义函数处理路径中的特殊字符
      const escapedSources = normalizedSources.map((s) => {
        const escaped = s.replace(/"/g, '\\"')
        return `"${escaped}"`
      })
      
      // 尝试多种字段名：source、metadata.source
      whereClause = `source IN (${escapedSources.join(', ')}) OR metadata.source IN (${escapedSources.join(', ')})`
      logDebug('Using where clause for source filtering', 'Search', { whereClause: whereClause.slice(0, 100) })
    }
    
    // 生成查询向量（支持跨语言检索）
    const embeddings = getEmbeddings()
    
    // 尝试跨语言查询：如果查询是中文，同时用英文翻译进行检索
    let queryVector = await embeddings.embedQuery(query)
    
    // 定义搜索结果类型
    interface SearchResult {
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
    
    let allSearchResults: SearchResult[] = []
    
    // 检测查询语言，如果是中文，尝试用英文翻译进行额外检索
    const { detectLanguage, generateCrossLanguageQueries } = await import('./queryTranslator')
    const queryLang = detectLanguage(query)
    
    // 定义搜索查询接口（部分类型，因为 LanceDB API 可能不完整）
    interface SearchQuery {
      where?: (clause: string) => SearchQuery
      refineFactor?: (factor: number) => SearchQuery
      limit: (n: number) => { toArray: () => Promise<SearchResult[]> }
    }
    
    // 辅助函数：执行向量搜索
    const performSearch = async (vector: number[], searchLimit: number): Promise<SearchResult[]> => {
      if (!table) {
        throw new Error('Table is null')
      }
      
      // 构建查询：明确指定向量列名 'vector'，并应用 where 过滤
      // 参考 LanceDB 官方文档：table.search() 支持 where 参数进行元数据过滤
      let searchQuery = table.search(vector) as unknown as SearchQuery
      
      // 应用 where 子句（如果存在）
      if (whereClause) {
        try {
          // 尝试使用 where 方法（如果支持）
          if (searchQuery.where && typeof searchQuery.where === 'function') {
            searchQuery = searchQuery.where(whereClause)
          }
        } catch (whereError) {
          console.warn('[searchWithScores] Where clause not supported, will filter after search:', whereError)
        }
      }
      
      // 设置检索参数
      // refineFactor: 用于提高检索质量的参数，值越大质量越高但速度越慢
      // 根据检索数量动态调整 refineFactor
      const refineFactor = fetchK > 200 ? 2 : 1
      
      try {
        // 尝试使用 refineFactor 优化检索质量
        if (searchQuery.refineFactor && typeof searchQuery.refineFactor === 'function') {
          searchQuery = searchQuery.refineFactor(refineFactor)
        }
      } catch (refineError) {
        // refineFactor 可能不支持，忽略
      }
      
      const results = await searchQuery.limit(searchLimit).toArray()
      return results
    }
    
    if (queryLang === 'zh') {
      console.log('[searchWithScores] Detected Chinese query, attempting cross-language search')
      try {
        const { queries } = await generateCrossLanguageQueries(query)
        
        // 使用所有查询变体进行检索
        const searchPromises = queries.map(async (q, index) => {
          const vector = await embeddings.embedQuery(q)
          const results = await performSearch(vector, fetchK)
          console.log(`[searchWithScores] Query variant ${index + 1} (${q.slice(0, 30)}...) got ${results.length} results`)
          return results.map((r: SearchResult) => ({ ...r, _queryIndex: index }))
        })
        
        const allResults = await Promise.all(searchPromises)
        allSearchResults = allResults.flat()
        
        // 去重：基于文档内容，保留距离最小的
        const docMap = new Map<string, SearchResult>()
        for (const result of allSearchResults) {
          const docKey = result.text || result.pageContent || JSON.stringify(result.metadata?.source || '')
          const existing = docMap.get(docKey)
          if (!existing || (result._distance ?? Infinity) < (existing._distance ?? Infinity)) {
            docMap.set(docKey, result)
          }
        }
        allSearchResults = Array.from(docMap.values())
        
        // 按距离排序
        allSearchResults.sort((a, b) => (a._distance ?? 0) - (b._distance ?? 0))
        allSearchResults = allSearchResults.slice(0, fetchK)
        
        console.log(`[searchWithScores] Cross-language search: ${allSearchResults.length} results after deduplication`)
      } catch (error) {
        console.warn('[searchWithScores] Cross-language search failed, using original query:', error)
        // 回退到原始查询
        allSearchResults = await performSearch(queryVector, fetchK)
      }
    } else {
      // 非中文查询，使用原始方法
      allSearchResults = await performSearch(queryVector, fetchK)
    }
    
    console.log('[searchWithScores] Native search got', allSearchResults.length, 'results')

    if (allSearchResults.length === 0) {
      return []
    }

    // 打印第一个结果的结构以供调试
    console.log('[searchWithScores] First result keys:', Object.keys(allSearchResults[0]))
    if (allSearchResults[0]._distance !== undefined) {
      console.log('[searchWithScores] First result distance:', allSearchResults[0]._distance)
    }

    // 转换为 Document 格式
    let results = allSearchResults.map((row) => {
      // LanceDB 返回的结果包含 _distance 字段，距离越小越相似
      const distance = row._distance ?? 0

      // 构造 Document 对象
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

    // 确保结果按距离排序（距离越小越相似）
    results = results.sort((a, b) => a.distance - b.distance)

    console.log('[searchWithScores] Before source filtering:', results.length)

    // 如果 where 子句不支持或未生效，进行后置过滤
    // 如果 where 子句生效，大部分过滤已在查询时完成，这里只做精确匹配和模糊匹配
    if (sources && sources.length > 0) {
      const normalizePath = (p: string): string => p.toLowerCase().replace(/\\/g, '/').trim()
      const sourceSet = new Set(sources.map((s) => normalizePath(s)))
      console.log('[searchWithScores] Post-filtering by sources:', Array.from(sourceSet).slice(0, 3))

      if (results.length > 0) {
        const firstDocSource = results[0].doc.metadata?.source
          ? normalizePath(String(results[0].doc.metadata.source))
          : '<no source>'
        console.log('[searchWithScores] First doc source:', firstDocSource)
      }

      // 如果 where 子句可能已生效，先检查是否需要过滤
      const needsFiltering = results.some(({ doc }) => {
        const docSource = doc.metadata?.source ? normalizePath(String(doc.metadata.source)) : ''
        return !sourceSet.has(docSource)
      })

      if (needsFiltering) {
        // 进行精确匹配和模糊匹配
        results = results.filter(({ doc }) => {
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
        console.log('[searchWithScores] After source filtering:', results.length)
      } else {
        console.log('[searchWithScores] Where clause filtering already applied, skipping post-filter')
      }
    }

    // 如果没有结果，直接返回空数组
    if (results.length === 0) {
      console.log('[searchWithScores] No results after filtering')
      return []
    }

    // 将 L2 距离转换为绝对相似度分数 [0, 1]
    // 使用 1 / (1 + distance) 公式，距离越小相似度越高
    // 这样可以得到绝对的相似度，而不是相对排名
    const distances = results.map((r) => r.distance)
    console.log(
      '[searchWithScores] Distance range:',
      Math.min(...distances),
      '-',
      Math.max(...distances)
    )

    // 将距离转换为绝对相似度分数
    const finalResults = results.map((r) => {
      // 使用 1 / (1 + distance) 转换为相似度
      // distance = 0 时，score = 1（完全匹配）
      // distance = 1 时，score ≈ 0.5
      // distance = 2 时，score ≈ 0.33
      // distance 越大，score 越接近 0
      const absoluteScore = 1 / (1 + r.distance)

      return {
        doc: r.doc,
        score: Math.max(0, Math.min(1, absoluteScore))
      }
    })

    console.log(
      '[searchWithScores] Normalized scores:',
      finalResults.slice(0, 4).map((r) => r.score.toFixed(3))
    )
    console.log('[searchWithScores] Returning', Math.min(finalResults.length, k), 'results')

    return finalResults.slice(0, k)
  } catch (e) {
    console.error('[searchWithScores] Native search failed:', e)

    // Fallback 到 LangChain 的 similaritySearch
    console.log('[searchWithScores] Falling back to LangChain similaritySearch')
    try {
      const docs = await vectorStore.similaritySearch(query, fetchK)
      console.log('[searchWithScores] Fallback got', docs.length, 'docs')

      // 过滤来源
      let filteredDocs = docs
      if (sources && sources.length > 0) {
        const normalizePath = (p: string): string => p.toLowerCase().replace(/\\/g, '/').trim()
        const sourceSet = new Set(sources.map((s) => normalizePath(s)))
        filteredDocs = docs.filter((doc) => {
          const docSource = doc.metadata?.source ? normalizePath(String(doc.metadata.source)) : ''
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
      console.error('[searchWithScores] Fallback also failed:', fallbackError)
      return []
    }
  }
}

export async function searchSimilarDocuments(
  query: string,
  options: SearchOptions = {}
): Promise<Document[]> {
  const { k = 4, sources } = options

  console.log(`[Search] Query: "${query}", Sources: ${sources?.length ?? 0} files`)

  // 调试日志缓冲区，批量写入以提高性能
  const isDev = process.env.NODE_ENV === 'development'
  const DEBUG_LOG_FLUSH_INTERVAL = RAG_CONFIG.LOG.DEBUG_LOG_FLUSH_INTERVAL
  let debugLogBuffer: string[] = []
  let debugLogTimer: NodeJS.Timeout | null = null

  const flushDebugLog = async (): Promise<void> => {
    if (debugLogBuffer.length === 0) return
    if (!isDev) {
      // 生产环境不写入文件日志
      debugLogBuffer = []
      return
    }

    const logs = debugLogBuffer.join('')
    debugLogBuffer = []

    try {
      await fsPromises.appendFile('debug_search.log', logs)
    } catch (error) {
      console.error('Failed to write debug log:', error)
    }
  }

  const logDebug = (msg: string): void => {
    if (!isDev) return

    const timestamp = new Date().toISOString()
    debugLogBuffer.push(`[${timestamp}] ${msg}\n`)

    // 如果缓冲区太大，立即刷新
    if (debugLogBuffer.length > RAG_CONFIG.LOG.MAX_DEBUG_LOG_BUFFER) {
      if (debugLogTimer) {
        clearTimeout(debugLogTimer)
        debugLogTimer = null
      }
      flushDebugLog()
    } else if (!debugLogTimer) {
      // 设置定时刷新
      debugLogTimer = setTimeout(() => {
        flushDebugLog()
        debugLogTimer = null
      }, DEBUG_LOG_FLUSH_INTERVAL)
    }
  }

  logDebug(`Query: "${query}", Sources count: ${sources?.length ?? 0}`)
  
  // 确保在函数返回前刷新日志
  const ensureLogFlushed = async (): Promise<void> => {
    if (debugLogTimer) {
      clearTimeout(debugLogTimer)
      debugLogTimer = null
    }
    await flushDebugLog()
  }

  // 如果 vectorStore 不存在，返回空结果
  if (!vectorStore) {
    await initVectorStore()
  }
  if (!vectorStore) {
    const msg = '[Search] No documents indexed yet, returning empty results'
    console.log(msg)
    logDebug(msg)
    await ensureLogFlushed()
    return []
  }

  const store = vectorStore

  // 使用缓存的文档数量
  const docCount = await getDocCountCached()
  logDebug(`Total rows in DB: ${docCount}`)

  // 如果指定了 sources，先检索更多文档，然后过滤
  // 因为 LanceDB 的过滤可能不直接支持 metadata 字段
  if (sources && sources.length > 0) {
    // 标准化路径进行比较
    const normalizePath = (p: string): string => {
      return p.toLowerCase().replace(/\\/g, '/').trim()
    }
    const sourceSet = new Set(sources.map((s) => normalizePath(s)))
    console.log('[Search] Filtering by sources:', Array.from(sourceSet))
    logDebug(`Filtering by ${sourceSet.size} sources. Example: ${Array.from(sourceSet)[0]}`)

    // 检索更多文档以确保有足够的匹配
    // 增加检索数量以提高召回率
    const { SEARCH } = RAG_CONFIG
    const fetchK = Math.max(k * SEARCH.FILTERED_SEARCH_MULTIPLIER, SEARCH.MIN_FETCH_K)
    let allDocs: Document[] = []
    try {
      allDocs = await store.similaritySearch(query, fetchK)
    } catch (e) {
      console.warn('Similarity search failed (filtered mode):', e)
      logDebug(`Similarity search failed (filtered): ${String(e)}`)
      await ensureLogFlushed()
      return []
    }

    console.log(`[Search] Retrieved ${allDocs.length} candidates (before filtering)`)
    logDebug(`Retrieved ${allDocs.length} candidates.`)

    if (allDocs.length > 0) {
      const meta = JSON.stringify(allDocs[0].metadata)
      console.log('[Search] First candidate metadata:', allDocs[0].metadata)
      logDebug(`First candidate metadata: ${meta}`)
      const docSource =
        typeof allDocs[0].metadata?.source === 'string'
          ? normalizePath(allDocs[0].metadata.source)
          : ''
      logDebug(`Normalized doc source: "${docSource}"`)
      logDebug(`Match check: ${sourceSet.has(docSource)}`)
    }

    // 过滤匹配的文档
    const filteredDocs = allDocs.filter((doc) => {
      const docSource =
        typeof doc.metadata?.source === 'string' ? normalizePath(doc.metadata.source) : ''

      // 尝试精确匹配
      if (sourceSet.has(docSource)) return true

      // 尝试模糊匹配（解决可能的路径格式差异，如 file:// 前缀或相对路径）
      // 只有当 sourceSet 比较小的时候才做这个昂贵的操作
      if (sourceSet.size < 50) {
        for (const s of sourceSet) {
          if (docSource.endsWith(s) || s.endsWith(docSource)) {
            return true
          }
        }
      }

      if (allDocs.length < 5) {
        // 仅在结果很少时打印不匹配的原因
        console.log(`[Search] Mismatch: doc "${docSource}" vs set`)
      }
      return false
    })

    console.log(`[Search] Found ${filteredDocs.length} docs after filtering`)
    logDebug(`Found ${filteredDocs.length} docs after filtering`)

    await ensureLogFlushed()
    // 返回前 k 个匹配的文档
    return filteredDocs.slice(0, k)
  }

  // 全库检索：动态调整检索数量以提高命中率
  const { SEARCH } = RAG_CONFIG
  const baseFetchK = Math.max(
    k * SEARCH.GLOBAL_SEARCH_MULTIPLIER, 
    Math.min(
      SEARCH.MAX_FETCH_K, 
      Math.max(
        SEARCH.MIN_FETCH_K, 
        Math.floor(docCount * SEARCH.GLOBAL_SEARCH_RATIO)
      )
    )
  )
  const fetchK = Math.max(baseFetchK, k * 10)
  
  console.log(`[Search] Global search, fetchK: ${fetchK}, docCount: ${docCount}`)
  logDebug(`Global search, fetchK: ${fetchK}, docCount: ${docCount}`)
  
  let results: Document[] = []
  try {
    // 全库检索时检索更多结果，然后取前 k 个
    results = await store.similaritySearch(query, fetchK)
    // 只返回前 k 个结果
    results = results.slice(0, k)
  } catch (e) {
    console.warn('Similarity search failed (global mode):', e)
    logDebug(`Similarity search failed (global): ${String(e)}`)
    await ensureLogFlushed()
    return []
  }
  console.log(`[Search] Global search found ${results.length} docs (from ${fetchK} candidates)`)
  logDebug(`Global search found ${results.length} docs (from ${fetchK} candidates)`)
  if (results.length > 0) {
    logDebug(`First global result metadata: ${JSON.stringify(results[0].metadata)}`)
  }
  
  await ensureLogFlushed()
  return results
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
 * 标准化路径（与搜索时保持一致）
 */
function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\\/g, '/').trim()
}

function escapePredicateValue(value: string): string {
  return value.replace(/"/g, '\\"')
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
  
  // 尝试多种路径格式和字段名
  const sourceVariants = [
    originalSource,           // 原始路径
    normalizedSource,         // 标准化路径
    originalSource.replace(/\\/g, '/'),  // 统一斜杠
    path.normalize(originalSource),      // 规范化路径
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
    
    // 尝试多种字段名和谓词格式
    const predicates = [
      `source == "${escapedVariant}"`,
      `metadata.source == "${escapedVariant}"`,
      `path == "${escapedVariant}"`,
      `url == "${escapedVariant}"`,
      // 也尝试 LIKE 匹配（如果支持）
      `source LIKE "%${escapedVariant.replace(/"/g, '')}%"`,
      `metadata.source LIKE "%${escapedVariant.replace(/"/g, '')}%"`,
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

  // 如果所有谓词都失败，尝试使用查询+删除的方式
  if (deletedCount === 0) {
    logWarn('All predicates failed, trying query-based deletion', 'VectorStore', { source })
    try {
      // 先查询匹配的记录数量
      const allRows = await table.search([0]).limit(10000).toArray() // 使用虚拟向量查询所有记录
      const matchingRows = allRows.filter((row: { source?: string; metadata?: { source?: string } }) => {
        const rowSource = row.source || row.metadata?.source
        if (!rowSource) return false
        
        const normalizedRowSource = normalizePath(String(rowSource))
        return uniqueVariants.some(variant => {
          const normalizedVariant = normalizePath(variant)
          return normalizedRowSource === normalizedVariant || 
                 normalizedRowSource.includes(normalizedVariant) ||
                 normalizedVariant.includes(normalizedRowSource)
        })
      })

      if (matchingRows.length > 0) {
        logInfo(`Found ${matchingRows.length} matching records, attempting deletion`, 'VectorStore')
        // 对每个匹配的记录尝试删除（通过唯一标识）
        // 注意：这需要表有唯一 ID 字段，如果不存在则可能无法精确删除
        for (const variant of uniqueVariants) {
          const escapedVariant = escapePredicateValue(variant)
          const finalPredicates = [
            `source == "${escapedVariant}"`,
            `metadata.source == "${escapedVariant}"`,
          ]
          for (const predicate of finalPredicates) {
            try {
              await (table as unknown as { delete: (where: string) => Promise<void> }).delete(predicate)
              deletedCount++
            } catch (e) {
              // 忽略错误
            }
          }
        }
      }
    } catch (queryError) {
      logError('Query-based deletion also failed', 'VectorStore', { source }, queryError as Error)
      lastError = queryError as Error
    }
  }

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
