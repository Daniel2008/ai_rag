import type { LanceDB } from '@langchain/community/vectorstores/lancedb'
import type { Connection, Table } from '@lancedb/lancedb'
import { Document } from '@langchain/core/documents'
import {
  Bool,
  Field,
  FixedSizeList,
  Float32,
  Float64,
  Int32,
  List,
  Schema,
  Struct,
  Utf8
} from 'apache-arrow'
import { app } from 'electron'
import path from 'path'
import fs from 'fs'
import fsPromises from 'fs/promises'
import { RAG_CONFIG } from '../../utils/config'
import { logDebug, logInfo, logWarn, logError } from '../../utils/logger'
import { getEmbeddings } from './embeddings'

export const TABLE_NAME = 'documents'

// LanceDB 连接状态
export let db: Connection | null = null
export let table: Table | null = null
export let vectorStore: LanceDB | null = null
export let LanceDBCtor: typeof import('@langchain/community/vectorstores/lancedb').LanceDB | null =
  null
export let connectFn: typeof import('@lancedb/lancedb').connect | null = null

export async function loadLanceModules(): Promise<void> {
  if (!LanceDBCtor) {
    const mod = await import('@langchain/community/vectorstores/lancedb')
    LanceDBCtor = mod.LanceDB
  }
  if (!connectFn) {
    const mod = await import('@lancedb/lancedb')
    connectFn = mod.connect
  }
}

export function getDbPath(): string {
  let dbPath: string
  if (app?.getPath) {
    dbPath = path.join(app.getPath('userData'), 'lancedb')
  } else {
    dbPath = path.join(process.cwd(), '.lancedb')
  }
  return dbPath
}

export async function createVectorIndexIfNeeded(tableRef: Table): Promise<void> {
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

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const item of value) {
    if (typeof item === 'string') result.push(item)
  }
  return result
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value
  return null
}

function normalizeNullableNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length > 0) {
    const num = Number(value)
    return Number.isFinite(num) ? num : null
  }
  return null
}

function normalizeBoolean(value: unknown): boolean {
  return !!value
}

function normalizeHeadingText(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function buildDocumentTableSchema(embeddingDimension: number): Schema {
  const utf8 = new Utf8()
  const float32 = new Float32()
  const float64 = new Float64()
  const int32 = new Int32()
  const bool = new Bool()

  const tagsType = new List(new Field('item', utf8, true))
  const vectorType = new FixedSizeList(embeddingDimension, new Field('item', float32, false))

  const metadataStruct = new Struct([
    new Field('source', utf8, true),
    new Field('tags', tagsType, true),
    new Field('fileName', utf8, true),
    new Field('fileType', utf8, true),
    new Field('pageNumber', int32, true),
    new Field('position', int32, true),
    new Field('sourceType', utf8, true),
    new Field('importedAt', float64, true),
    new Field('chunkIndex', int32, true),
    new Field('blockTypes', tagsType, true),
    new Field('hasHeading', bool, true),
    new Field('headingText', utf8, true),
    new Field('chunkingStrategy', utf8, true)
  ])

  return new Schema([
    new Field('vector', vectorType, false),
    new Field('text', utf8, true),
    new Field('metadata', metadataStruct, true),
    new Field('source', utf8, true),
    new Field('tags', tagsType, true),
    new Field('fileName', utf8, true),
    new Field('fileType', utf8, true),
    new Field('pageNumber', int32, true),
    new Field('position', int32, true),
    new Field('sourceType', utf8, true),
    new Field('importedAt', float64, true),
    new Field('chunkIndex', int32, true),
    new Field('blockTypes', tagsType, true),
    new Field('hasHeading', bool, true),
    new Field('headingText', utf8, true),
    new Field('chunkingStrategy', utf8, true)
  ])
}

/**
 * 确保表存在并包含文档
 */
export async function ensureTableWithDocuments(
  docs: Document[],
  appendMode: boolean = false
): Promise<LanceDB> {
  const dbPath = getDbPath()
  const embeddings = getEmbeddings()

  if (!db) {
    logDebug('Connecting to LanceDB', 'VectorStore', { dbPath })
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
        logDebug('Opening existing table', 'VectorStore', { tableName: TABLE_NAME })
        table = await conn.openTable(TABLE_NAME)
      }

      // 准备要插入的数据
      const schema = await table.schema()
      const existingColumns = schema.fields.map((f) => f.name)
      logDebug('Existing table columns', 'VectorStore', { existingColumns })

      // 生成向量嵌入
      const texts = docs.map((d) => d.pageContent)
      logDebug('Generating embeddings for append', 'VectorStore', { count: texts.length })
      const vectors = await embeddings.embedDocuments(texts)
      logDebug('Embeddings generated', 'VectorStore', { count: vectors.length })

      const records = docs.map((doc, i) => {
        const record: Record<string, unknown> = {
          vector: vectors[i],
          text: doc.pageContent
        }

        // 映射元数据到顶层列（如果列存在）
        const metadataFields = [
          'source',
          'tags',
          'fileName',
          'fileType',
          'pageNumber',
          'position',
          'sourceType',
          'importedAt',
          'chunkIndex',
          'blockTypes',
          'hasHeading',
          'headingText',
          'chunkingStrategy'
        ]

        for (const field of metadataFields) {
          if (existingColumns.includes(field)) {
            const value = doc.metadata?.[field]
            if (field === 'tags' || field === 'blockTypes') {
              record[field] = Array.isArray(value) ? value : []
            } else if (field === 'hasHeading') {
              record[field] = !!value
            } else if (field === 'headingText') {
              record[field] = value ?? ''
            } else {
              record[field] = value ?? null
            }
          }
        }

        // 保持对 LangChain metadata 列的兼容（如果存在）
        if (existingColumns.includes('metadata')) {
          record.metadata = doc.metadata
        }

        return record
      })

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
        'Failed to append documents via native add, trying LangChain fallback',
        'VectorStore',
        undefined,
        appendError as Error
      )

      // 尝试使用 LangChain 的 addDocuments 作为备选方案
      try {
        if (!vectorStore) {
          if (!table) table = await conn.openTable(TABLE_NAME)
          vectorStore = new LanceDBCtor!(embeddings, { table })
        }
        await vectorStore.addDocuments(docs)
        logInfo(`Appended ${docs.length} documents via LangChain addDocuments`, 'VectorStore')
        return vectorStore
      } catch (lcError) {
        logError(
          'LangChain addDocuments also failed',
          'VectorStore',
          undefined,
          lcError as Error
        )
        // 追加失败时抛出错误，而不是回退到覆盖模式
        throw new Error(`Failed to append documents: ${lcError instanceof Error ? lcError.message : String(lcError)}`)
      }
    }
  }

  // 如果是追加模式但走到了这里（说明表不存在），或者不是追加模式
  // 创建新表或重建表
  if (appendMode && tableExists) {
    // 理论上不应该走到这里，除非上面的逻辑有漏洞
    throw new Error('Unexpected state: table exists and append mode enabled but append logic skipped')
  }
  logInfo('Creating/updating LanceDB table with documents', 'VectorStore', {
    docCount: docs.length,
    tableExists,
    appendMode
  })

  // 这里的逻辑也需要改进：如果是为了修复架构而重建，应该确保包含所有字段
  // 生成向量嵌入
  const texts = docs.map((d) => d.pageContent)
  logDebug('Generating embeddings for create/rebuild', 'VectorStore', { count: texts.length })
  const vectors = await embeddings.embedDocuments(texts)
  logDebug('Embeddings generated', 'VectorStore', { count: vectors.length })

  const embeddingDimension = vectors[0]?.length ?? 0
  if (embeddingDimension <= 0) {
    throw new Error('Failed to determine embedding dimension')
  }
  const schema = buildDocumentTableSchema(embeddingDimension)

  const fullRecords = docs.map((doc, i) => {
    const source = normalizeNullableString(doc.metadata?.source)
    const tags = normalizeStringArray(doc.metadata?.tags)
    const fileName = normalizeNullableString(doc.metadata?.fileName)
    const fileType = normalizeNullableString(doc.metadata?.fileType)
    const pageNumber = normalizeNullableNumber(doc.metadata?.pageNumber)
    const position = normalizeNullableNumber(doc.metadata?.position)
    const sourceType = normalizeNullableString(doc.metadata?.sourceType)
    const importedAt = normalizeNullableNumber(doc.metadata?.importedAt)
    const chunkIndex = normalizeNullableNumber(doc.metadata?.chunkIndex)
    const blockTypes = normalizeStringArray(doc.metadata?.blockTypes)
    const hasHeading = normalizeBoolean(doc.metadata?.hasHeading)
    const headingText = normalizeHeadingText(doc.metadata?.headingText)
    const chunkingStrategy = normalizeNullableString(doc.metadata?.chunkingStrategy)

    const metadata = {
      source,
      tags,
      fileName,
      fileType,
      pageNumber: pageNumber === null ? null : Math.trunc(pageNumber),
      position: position === null ? null : Math.trunc(position),
      sourceType,
      importedAt,
      chunkIndex: chunkIndex === null ? null : Math.trunc(chunkIndex),
      blockTypes,
      hasHeading,
      headingText,
      chunkingStrategy
    }

    return {
      vector: vectors[i],
      text: doc.pageContent,
      metadata,
      ...metadata
    }
  })

  await loadLanceModules()

  // 使用原生 createTable 确保包含所有我们想要的列
  if (!db) db = await connectFn!(dbPath)
  const conn2 = db as Connection
  table = await conn2.createTable(TABLE_NAME, fullRecords, { mode: 'overwrite', schema })
  await createVectorIndexIfNeeded(table)

  vectorStore = new LanceDBCtor!(embeddings, { table })
  return vectorStore
}

export async function initVectorStore(): Promise<void> {
  if (vectorStore) return

  const dbPath = getDbPath()
  logInfo('Initializing LanceDB', 'VectorStore', { dbPath })

  if (!fs.existsSync(dbPath)) {
    fs.mkdirSync(dbPath, { recursive: true })
  }

  try {
    await loadLanceModules()
    if (!db) {
      db = await connectFn!(dbPath)
    }

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

export function setVectorStore(store: LanceDB | null) {
  vectorStore = store
}

export function setTable(t: Table | null) {
  table = t
}

export function setDb(conn: Connection | null) {
  db = conn
}
