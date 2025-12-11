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
  // 兼容非Electron环境
  if (BrowserWindow?.getAllWindows) {
    const windows = BrowserWindow.getAllWindows()
    windows.forEach((win) => {
      win.webContents.send('embedding:progress', progress)
    })
  } else {
    // 在非Electron环境下打印进度
    console.log('Embedding progress:', progress)
  }
}

// 性能优化：缓存 Embeddings 实例，只在配置变化时重新创建
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
  console.log('Initializing LanceDB at:', dbPath)

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
        console.log('Opened existing LanceDB table')
      } catch (tableError) {
        // 表打开失败，可能是因为嵌入模型维度不匹配，标记为需要重建
        console.warn('Failed to open existing table, may need rebuild:', tableError)
        vectorStore = null
        table = null
      }
    } else {
      // 表不存在时，我们不立即创建，而是标记需要在添加文档时创建
      // 设置一个空的 vectorStore 标记，让 addDocumentsToStore 负责创建
      vectorStore = null
      console.log('LanceDB table does not exist, will be created on first document add')
    }
  } catch (error) {
    console.warn('Failed to connect to LanceDB:', error)
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
  console.log('Creating/updating LanceDB table with documents')
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

  // 计算进度范围（默认0-100，接收起始进度后调整为startProgress-100）
  const progressRange = 100 - startProgress

  // 总是使用 ensureTableWithDocuments，它会处理表的创建或更新
  // 这样可以避免 vectorStore 指向无效表的问题
  onProgress?.({
    status: ProgressStatus.PROCESSING,
    progress: startProgress,
    message: '正在索引文档...',
    taskType: TaskType.INDEX_REBUILD
  })

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
        onProgress?.({
          status: ProgressStatus.PROCESSING,
          progress: adjustedProgress,
          message: `正在生成向量 ${adjustedProgress}%`,
          taskType: TaskType.EMBEDDING_GENERATION
        })
      } else {
        // 其他进度类型直接传递
        onProgress?.(progress)
      }
    })
  }

  try {
    vectorStore = await ensureTableWithDocuments(docs)
    onProgress?.({
      status: ProgressStatus.COMPLETED,
      progress: 100,
      message: '索引完成',
      taskType: TaskType.INDEX_REBUILD
    })
    console.log(`Added ${docs.length} documents to LanceDB`)
  } catch (error) {
    console.error('Failed to add documents, trying to recreate table:', error)
    // 如果失败，尝试重置并重新创建
    await resetVectorStore()
    vectorStore = await ensureTableWithDocuments(docs)
    onProgress?.({
      status: ProgressStatus.COMPLETED,
      progress: 100,
      message: '索引完成（已重建）',
      taskType: TaskType.INDEX_REBUILD
    })
    console.log(`Recreated LanceDB table and added ${docs.length} documents`)
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

export async function getDocCount(): Promise<number> {
  await initVectorStore()
  if (!table) return 0
  return await table.countRows()
}

export async function searchSimilarDocumentsWithScores(
  query: string,
  options: SearchOptions = {}
): Promise<{ doc: Document; score: number }[]> {
  const { k = 4, sources } = options

  console.log('[searchWithScores] Starting search, query:', query.slice(0, 50))
  console.log('[searchWithScores] Sources filter:', sources)

  await initVectorStore()
  console.log('[searchWithScores] vectorStore initialized:', !!vectorStore)
  console.log('[searchWithScores] table exists:', !!table)

  if (!vectorStore || !table) {
    console.log('[searchWithScores] vectorStore or table is null, returning empty')
    return []
  }

  // 检查数据库中的文档数量
  try {
    const count = await table.countRows()
    console.log('[searchWithScores] Total docs in DB:', count)
  } catch (e) {
    console.log('[searchWithScores] Failed to count rows:', e)
  }

  // 动态计算检索数量：根据库大小和是否全库检索调整
  let docCount = 0
  try {
    docCount = await table.countRows()
  } catch (e) {
    console.warn('[searchWithScores] Failed to get doc count:', e)
  }
  
  // 全库检索时，需要检索更多结果以确保命中率
  // 如果库很大，需要检索更多；如果指定了 sources，可以检索少一些
  const isGlobalSearch = !sources || sources.length === 0
  const baseFetchK = isGlobalSearch 
    ? Math.max(k * 50, Math.min(500, Math.max(200, Math.floor(docCount * 0.1))))  // 全库检索：至少200，最多500，或库的10%
    : Math.max(k * 20, 100)  // 指定来源：至少100
  const fetchK = Math.max(baseFetchK, k * 10)  // 至少是 k 的 10 倍
  
  console.log('[searchWithScores] Using search, fetchK:', fetchK, 'docCount:', docCount, 'isGlobalSearch:', isGlobalSearch)

  try {
    // 直接使用原生 LanceDB API，因为 LangChain 的 similaritySearchWithScore 
    // 在当前版本中不返回有效的分数（返回 undefined）
    // 原生 API 可以正确返回 _distance 字段
    console.log('[searchWithScores] Using native LanceDB API for accurate distance scores')
    
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
      console.log('[searchWithScores] Using where clause for source filtering:', whereClause.slice(0, 100) + '...')
    }
    
    // 生成查询向量（支持跨语言检索）
    const embeddings = getEmbeddings()
    
    // 尝试跨语言查询：如果查询是中文，同时用英文翻译进行检索
    let queryVector = await embeddings.embedQuery(query)
    let allSearchResults: any[] = []
    
    // 检测查询语言，如果是中文，尝试用英文翻译进行额外检索
    const { detectLanguage, generateCrossLanguageQueries } = await import('./queryTranslator')
    const queryLang = detectLanguage(query)
    
    // 辅助函数：执行向量搜索
    const performSearch = async (vector: number[], searchLimit: number): Promise<any[]> => {
      if (!table) {
        throw new Error('Table is null')
      }
      
      // 构建查询：明确指定向量列名 'vector'，并应用 where 过滤
      // 参考 LanceDB 官方文档：table.search() 支持 where 参数进行元数据过滤
      let searchQuery = table.search(vector)
      
      // 应用 where 子句（如果存在）
      if (whereClause) {
        try {
          // 尝试使用 where 方法（如果支持）
          if (typeof (searchQuery as any).where === 'function') {
            searchQuery = (searchQuery as any).where(whereClause) as any
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
        if (typeof (searchQuery as any).refineFactor === 'function') {
          searchQuery = (searchQuery as any).refineFactor(refineFactor) as any
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
          return results.map((r: any) => ({ ...r, _queryIndex: index }))
        })
        
        const allResults = await Promise.all(searchPromises)
        allSearchResults = allResults.flat()
        
        // 去重：基于文档内容，保留距离最小的
        const docMap = new Map<string, any>()
        for (const result of allSearchResults) {
          const docKey = result.text || result.pageContent || JSON.stringify(result.metadata?.source || '')
          if (!docMap.has(docKey) || result._distance < docMap.get(docKey)._distance) {
            docMap.set(docKey, result)
          }
        }
        allSearchResults = Array.from(docMap.values())
        
        // 按距离排序
        allSearchResults.sort((a, b) => (a._distance || 0) - (b._distance || 0))
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

  const logDebug = async (msg: string): Promise<void> => {
    try {
      await fsPromises.appendFile('debug_search.log', `[${new Date().toISOString()}] ${msg}\n`)
    } catch (error) {
      // 忽略日志写入错误
      console.error('Failed to write debug log:', error)
    }
  }

  await logDebug(`Query: "${query}", Sources count: ${sources?.length ?? 0}`)

  // 如果 vectorStore 不存在，返回空结果
  if (!vectorStore) {
    await initVectorStore()
  }
  if (!vectorStore) {
    const msg = '[Search] No documents indexed yet, returning empty results'
    console.log(msg)
    await logDebug(msg)
    return []
  }

  const store = vectorStore

  // 记录一下数据库总行数
  let docCount = 0
  try {
    docCount = await table?.countRows() ?? 0
    await logDebug(`Total rows in DB: ${docCount}`)
  } catch (e) {
    await logDebug(`Failed to get row count: ${e}`)
  }

  // 如果指定了 sources，先检索更多文档，然后过滤
  // 因为 LanceDB 的过滤可能不直接支持 metadata 字段
  if (sources && sources.length > 0) {
    // 标准化路径进行比较
    const normalizePath = (p: string): string => {
      return p.toLowerCase().replace(/\\/g, '/').trim()
    }
    const sourceSet = new Set(sources.map((s) => normalizePath(s)))
    console.log('[Search] Filtering by sources:', Array.from(sourceSet))
    await logDebug(`Filtering by ${sourceSet.size} sources. Example: ${Array.from(sourceSet)[0]}`)

    // 检索更多文档以确保有足够的匹配
    // 增加检索数量以提高召回率
    const fetchK = Math.max(k * 20, 100)
    let allDocs: Document[] = []
    try {
      allDocs = await store.similaritySearch(query, fetchK)
    } catch (e) {
      console.warn('Similarity search failed (filtered mode):', e)
      await logDebug(`Similarity search failed (filtered): ${String(e)}`)
      return []
    }

    console.log(`[Search] Retrieved ${allDocs.length} candidates (before filtering)`)
    await logDebug(`Retrieved ${allDocs.length} candidates.`)

    if (allDocs.length > 0) {
      const meta = JSON.stringify(allDocs[0].metadata)
      console.log('[Search] First candidate metadata:', allDocs[0].metadata)
      await logDebug(`First candidate metadata: ${meta}`)
      const docSource =
        typeof allDocs[0].metadata?.source === 'string'
          ? normalizePath(allDocs[0].metadata.source)
          : ''
      await logDebug(`Normalized doc source: "${docSource}"`)
      await logDebug(`Match check: ${sourceSet.has(docSource)}`)
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
    await logDebug(`Found ${filteredDocs.length} docs after filtering`)

    // 返回前 k 个匹配的文档
    return filteredDocs.slice(0, k)
  }

  // 全库检索：动态调整检索数量以提高命中率
  const baseFetchK = Math.max(k * 50, Math.min(500, Math.max(200, Math.floor(docCount * 0.1))))
  const fetchK = Math.max(baseFetchK, k * 10)
  
  console.log(`[Search] Global search, fetchK: ${fetchK}, docCount: ${docCount}`)
  await logDebug(`Global search, fetchK: ${fetchK}, docCount: ${docCount}`)
  
  let results: Document[] = []
  try {
    // 全库检索时检索更多结果，然后取前 k 个
    results = await store.similaritySearch(query, fetchK)
    // 只返回前 k 个结果
    results = results.slice(0, k)
  } catch (e) {
    console.warn('Similarity search failed (global mode):', e)
    await logDebug(`Similarity search failed (global): ${String(e)}`)
    return []
  }
  console.log(`[Search] Global search found ${results.length} docs (from ${fetchK} candidates)`)
  await logDebug(`Global search found ${results.length} docs (from ${fetchK} candidates)`)
  if (results.length > 0) {
    await logDebug(`First global result metadata: ${JSON.stringify(results[0].metadata)}`)
  }
  return results
}

// Clean up function
export async function closeVectorStore(): Promise<void> {
  vectorStore = null
  table = null
  db = null
  cachedEmbeddings = null
  cachedEmbeddingsConfig = null
}

export async function resetVectorStore(): Promise<void> {
  const dbPath = getDbPath()
  await closeVectorStore()
  if (fs.existsSync(dbPath)) {
    await fsPromises.rm(dbPath, { recursive: true, force: true })
  }
}

function escapePredicateValue(value: string): string {
  return value.replace(/"/g, '\\"')
}

export async function removeSourceFromStore(source: string): Promise<void> {
  await initVectorStore()
  if (!db) return
  const conn = db as Connection
  if (!table) {
    const names = await conn.tableNames()
    if (!names.includes(TABLE_NAME)) return
    table = await conn.openTable(TABLE_NAME)
  }
  const v = escapePredicateValue(source)
  const predicates = [
    `source == "${v}"`,
    `metadata.source == "${v}"`,
    `path == "${v}"`,
    `url == "${v}"`
  ]
  for (const p of predicates) {
    try {
      await (table as unknown as { delete: (where: string) => Promise<void> }).delete(p)
      break
    } catch (e) {
      console.warn('Delete by source failed with predicate', p, e)
    }
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
  // 清除所有缓存，包括数据库连接
  vectorStore = null
  table = null
  db = null
  // 同时清除本地模型缓存
  const localEmbeddings = await import('./localEmbeddings')
  localEmbeddings.clearModelCache()
  console.log('Embeddings, vector store, and database connection cache cleared')
}
