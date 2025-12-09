import { LanceDB } from '@langchain/community/vectorstores/lancedb'
import { connect, Connection, Table } from '@lancedb/lancedb'
import { OllamaEmbeddings } from '@langchain/ollama'
import { Document } from '@langchain/core/documents'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { getSettings } from '../settings'

// Singleton instances
let db: Connection | null = null
let table: Table | null = null
let vectorStore: LanceDB | null = null

// 性能优化：缓存 Embeddings 实例
let cachedEmbeddings: OllamaEmbeddings | null = null
let cachedEmbeddingsConfig: { model: string; baseUrl: string } | null = null

const TABLE_NAME = 'documents'

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'lancedb')
}

// 性能优化：缓存 OllamaEmbeddings 实例，只在配置变化时重新创建
function getEmbeddings(): OllamaEmbeddings {
  const settings = getSettings()
  const currentConfig = {
    model: settings.embeddingModel,
    baseUrl: settings.ollamaUrl
  }

  // 检查配置是否变化
  if (
    cachedEmbeddings &&
    cachedEmbeddingsConfig &&
    cachedEmbeddingsConfig.model === currentConfig.model &&
    cachedEmbeddingsConfig.baseUrl === currentConfig.baseUrl
  ) {
    return cachedEmbeddings
  }

  // 创建新实例并缓存
  cachedEmbeddings = new OllamaEmbeddings({
    model: currentConfig.model,
    baseUrl: currentConfig.baseUrl
  })
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

  db = await connect(dbPath)
  const embeddings = getEmbeddings()

  // Check if table exists
  const tableNames = await db.tableNames()

  if (tableNames.includes(TABLE_NAME)) {
    // Open existing table
    table = await db.openTable(TABLE_NAME)
    vectorStore = new LanceDB(embeddings, { table })
    console.log('Opened existing LanceDB table')
  } else {
    // 表不存在时，我们不立即创建，而是标记需要在添加文档时创建
    // 设置一个空的 vectorStore 标记，让 addDocumentsToStore 负责创建
    vectorStore = null
    console.log('LanceDB table does not exist, will be created on first document add')
  }
}

// 确保表存在，如果不存在则用初始文档创建
async function ensureTableWithDocuments(docs: Document[]): Promise<LanceDB> {
  const dbPath = getDbPath()
  const embeddings = getEmbeddings()

  if (!db) {
    db = await connect(dbPath)
  }

  const tableNames = await db.tableNames()

  if (tableNames.includes(TABLE_NAME)) {
    table = await db.openTable(TABLE_NAME)
    return new LanceDB(embeddings, { table })
  }

  // 使用提供的文档创建新表
  console.log('Creating new LanceDB table with initial documents')
  return await LanceDB.fromDocuments(docs, embeddings, {
    uri: dbPath,
    tableName: TABLE_NAME
  })
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

export async function addDocumentsToStore(docs: Document[]): Promise<void> {
  if (docs.length === 0) return

  // 如果 vectorStore 不存在（表还没创建），使用文档来创建
  if (!vectorStore) {
    vectorStore = await ensureTableWithDocuments(docs)
    console.log(`Created LanceDB table and added ${docs.length} documents`)
    return
  }

  // vectorStore 已存在，直接添加文档
  await vectorStore.addDocuments(docs)
  console.log(`Added ${docs.length} documents to LanceDB`)
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
