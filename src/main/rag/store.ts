import { LanceDB } from '@langchain/community/vectorstores/lancedb'
import { connect, Connection, Table } from '@lancedb/lancedb'
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

// Singleton instances
let db: Connection | null = null
let table: Table | null = null
let vectorStore: LanceDB | null = null

// 性能优化：缓存 Embeddings 实例
let cachedEmbeddings: Embeddings | null = null
let cachedEmbeddingsConfig: { provider: string; model: string; baseUrl?: string } | null = null

const TABLE_NAME = 'documents'

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'lancedb')
}

// 发送嵌入模型进度到渲染进程
function sendEmbeddingProgress(progress: Parameters<ModelProgressCallback>[0]): void {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    win.webContents.send('embedding:progress', progress)
  })
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

export async function initVectorStore(): Promise<void> {
  if (vectorStore) return

  const dbPath = getDbPath()
  console.log('Initializing LanceDB at:', dbPath)

  // Ensure directory exists
  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true })
  }

  try {
    db = await connect(dbPath)

    // Check if table exists
    const tableNames = await db.tableNames()

    if (tableNames.includes(TABLE_NAME)) {
      // Open existing table
      try {
        table = await db.openTable(TABLE_NAME)
        const embeddings = getEmbeddings()
        vectorStore = new LanceDB(embeddings, { table })
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
    db = await connect(dbPath)
  }

  // 总是使用 fromDocuments 创建新表，这样可以确保表结构正确
  // 如果表已存在，LanceDB.fromDocuments 会添加到现有表
  console.log('Creating/updating LanceDB table with documents')
  const store = await LanceDB.fromDocuments(docs, embeddings, {
    uri: dbPath,
    tableName: TABLE_NAME
  })

  // 更新缓存的 table 引用
  const tableNames = await db.tableNames()
  if (tableNames.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME)
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

/** 进度回调函数类型 */
export type ProgressCallback = (current: number, total: number, stage: string) => void

export async function addDocumentsToStore(
  docs: Document[],
  onProgress?: ProgressCallback
): Promise<void> {
  if (docs.length === 0) return

  const total = docs.length

  // 总是使用 ensureTableWithDocuments，它会处理表的创建或更新
  // 这样可以避免 vectorStore 指向无效表的问题
  onProgress?.(0, total, '正在索引文档...')

  try {
    vectorStore = await ensureTableWithDocuments(docs)
    onProgress?.(total, total, '索引完成')
    console.log(`Added ${docs.length} documents to LanceDB`)
  } catch (error) {
    console.error('Failed to add documents, trying to recreate table:', error)
    // 如果失败，尝试重置并重新创建
    await resetVectorStore()
    vectorStore = await ensureTableWithDocuments(docs)
    onProgress?.(total, total, '索引完成（已重建）')
    console.log(`Recreated LanceDB table and added ${docs.length} documents`)
  }
}

export interface SearchOptions {
  k?: number
  sources?: string[]
}

export async function searchSimilarDocuments(
  query: string,
  options: SearchOptions = {}
): Promise<Document[]> {
  const { k = 4, sources } = options

  // 如果 vectorStore 不存在，返回空结果
  if (!vectorStore) {
    await initVectorStore()
  }
  if (!vectorStore) {
    console.log('No documents indexed yet, returning empty results')
    return []
  }

  const store = vectorStore

  // 如果指定了 sources，先检索更多文档，然后过滤
  // 因为 LanceDB 的过滤可能不直接支持 metadata 字段
  if (sources && sources.length > 0) {
    // 标准化路径进行比较
    const normalizePath = (p: string): string => {
      return p.toLowerCase().replace(/\\/g, '/').trim()
    }
    const sourceSet = new Set(sources.map((s) => normalizePath(s)))

    // 检索更多文档以确保有足够的匹配
    const allDocs = await store.similaritySearch(query, k * 10)

    // 过滤匹配的文档
    const filteredDocs = allDocs.filter((doc) => {
      const docSource =
        typeof doc.metadata?.source === 'string' ? normalizePath(doc.metadata.source) : ''
      return sourceSet.has(docSource)
    })

    // 返回前 k 个匹配的文档
    return filteredDocs.slice(0, k)
  }

  return store.similaritySearch(query, k)
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
