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

const TABLE_NAME = 'documents'

function getDbPath(): string {
  const userDataPath = app.getPath('userData')
  return path.join(userDataPath, 'lancedb')
}

function getEmbeddings(): OllamaEmbeddings {
  const settings = getSettings()
  return new OllamaEmbeddings({
    model: settings.embeddingModel,
    baseUrl: settings.ollamaUrl
  })
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
    // Create new table with initial empty document (LanceDB requires at least one document)
    // We'll use fromDocuments which handles table creation
    vectorStore = await LanceDB.fromDocuments([], embeddings, {
      uri: dbPath,
      tableName: TABLE_NAME
    })
    console.log('Created new LanceDB table')
  }
}

export async function getVectorStore(): Promise<LanceDB> {
  if (!vectorStore) {
    await initVectorStore()
  }
  return vectorStore!
}

export async function addDocumentsToStore(docs: Document[]): Promise<void> {
  if (docs.length === 0) return

  const store = await getVectorStore()
  await store.addDocuments(docs)
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
  const store = await getVectorStore()

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
}

export async function resetVectorStore(): Promise<void> {
  const dbPath = getDbPath()
  await closeVectorStore()
  if (fs.existsSync(dbPath)) {
    await fsPromises.rm(dbPath, { recursive: true, force: true })
  }
}
