import type { LanceDB } from '@langchain/community/vectorstores/lancedb'
import type { Connection, Table } from '@lancedb/lancedb'
import { Document } from '@langchain/core/documents'
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

      // 准备要插入的数据
      const schema = await table.schema()
      const existingColumns = schema.fields.map((f) => f.name)
      logDebug('Existing table columns', 'VectorStore', { existingColumns })

      // 生成向量嵌入
      const texts = docs.map((d) => d.pageContent)
      const vectors = await embeddings.embedDocuments(texts)

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
          'LangChain addDocuments also failed, falling back to recreate',
          'VectorStore',
          undefined,
          lcError as Error
        )
        // 最终失败，回退到重建模式
      }
    }
  }

  // 创建新表或重建表
  logInfo('Creating/updating LanceDB table with documents', 'VectorStore', {
    docCount: docs.length,
    tableExists,
    appendMode
  })

  // 这里的逻辑也需要改进：如果是为了修复架构而重建，应该确保包含所有字段
  // 生成向量嵌入
  const texts = docs.map((d) => d.pageContent)
  const vectors = await embeddings.embedDocuments(texts)

  const fullRecords = docs.map((doc, i) => ({
    vector: vectors[i],
    text: doc.pageContent,
    metadata: doc.metadata, // 必须包含 metadata 以保持 LangChain 兼容性
    source: doc.metadata?.source ?? null,
    tags: doc.metadata?.tags ?? [],
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

  await loadLanceModules()

  // 使用原生 createTable 确保包含所有我们想要的列
  if (!db) db = await connectFn!(dbPath)
  const conn2 = db as Connection
  table = await conn2.createTable(TABLE_NAME, fullRecords, { mode: 'overwrite' })
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
