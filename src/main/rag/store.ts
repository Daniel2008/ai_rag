import { LanceDB } from '@langchain/community/vectorstores/lancedb'
import { connect, Connection, Table } from '@lancedb/lancedb'
import { OllamaEmbeddings } from '@langchain/ollama'
import { Document } from '@langchain/core/documents'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
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

export async function searchSimilarDocuments(
  query: string,
  k = 4
): Promise<Document[]> {
  const store = await getVectorStore()
  return store.similaritySearch(query, k)
}

// Clean up function
export async function closeVectorStore(): Promise<void> {
  vectorStore = null
  table = null
  db = null
}
