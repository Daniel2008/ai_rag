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

  // 扩展元数据结构，支持更多字段包括动态字段
  // 注意：extra字段使用JSON字符串格式存储复杂对象
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
    new Field('chunkingStrategy', utf8, true),
    // 新增字段以支持更多元数据
    new Field('title', utf8, true),
    new Field('description', utf8, true),
    new Field('author', utf8, true),
    new Field('created', utf8, true),
    new Field('modified', utf8, true),
    // 为其他动态字段准备一个通用的扩展字段，使用JSON字符串存储
    new Field('extra', utf8, true)
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
    new Field('chunkingStrategy', utf8, true),
    // 重复字段以确保兼容性
    new Field('title', utf8, true),
    new Field('description', utf8, true),
    new Field('author', utf8, true)
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
          'chunkingStrategy',
          'title',
          'description',
          'author',
          'created',
          'modified'
        ]

        for (const field of metadataFields) {
          if (existingColumns.includes(field)) {
            const value = doc.metadata?.[field]
            if (field === 'tags' || field === 'blockTypes') {
              record[field] = Array.isArray(value) ? value : []
            } else if (field === 'hasHeading') {
              record[field] = !!value
            } else if (field === 'headingText' || field === 'title' || field === 'description' || field === 'author' || field === 'created' || field === 'modified') {
              // 只在值存在时才设置，避免设置空字符串导致架构冲突
              if (value !== undefined && value !== null) {
                record[field] = String(value)
              }
            } else if (field === 'pageNumber' || field === 'position' || field === 'chunkIndex' || field === 'importedAt') {
              record[field] = value ?? null
            } else {
              record[field] = value ?? null
            }
          }
        }

        // 保持对 LangChain metadata 列的兼容（如果存在）
        if (existingColumns.includes('metadata')) {
          // 过滤掉可能导致问题的动态字段，只保留已知字段
          const safeMetadata: Record<string, unknown> = {}
          const knownFields = [
            'source', 'tags', 'fileName', 'fileType', 'pageNumber', 'position',
            'sourceType', 'importedAt', 'chunkIndex', 'blockTypes', 'hasHeading',
            'headingText', 'chunkingStrategy', 'title', 'description', 'author',
            'created', 'modified'
          ]
          
          knownFields.forEach(field => {
            if (doc.metadata?.[field] !== undefined) {
              safeMetadata[field] = doc.metadata[field]
            }
          })
          
          // 如果还有其他字段，打包到extra中 - 使用JSON字符串
          const extraFields = Object.keys(doc.metadata || {}).filter(
            field => !knownFields.includes(field)
          )
          if (extraFields.length > 0) {
            const extraObj: Record<string, unknown> = {}
            for (const field of extraFields) {
              extraObj[field] = doc.metadata?.[field]
            }
            safeMetadata.extra = JSON.stringify(extraObj)
          }
          
          record.metadata = safeMetadata
        }

        return record
      })

      // 使用 LanceDB 原生 add 方法追加数据
      try {
        await (table as unknown as { add: (data: unknown[]) => Promise<void> }).add(records)
      } catch (error) {
        // 如果原生添加失败，可能是架构不匹配
        logWarn('LanceDB native add failed, checking table schema', 'VectorStore', {
          error: error instanceof Error ? error.message : String(error)
        })
        
        // 检查表架构，确保包含所有必要字段
        const currentSchema = await table.schema()
        const currentFields = currentSchema.fields.map(f => f.name)
        
        // 检查缺失的关键字段
        const requiredFields = ['source', 'tags', 'fileName', 'fileType', 'pageNumber', 'position', 
                                'sourceType', 'importedAt', 'chunkIndex', 'blockTypes', 'hasHeading',
                                'headingText', 'chunkingStrategy', 'title', 'description', 'author',
                                'created', 'modified', 'extra']
        
        const missingFields = requiredFields.filter(f => !currentFields.includes(f) && !currentFields.includes('metadata'))
        
        if (missingFields.length > 0 || !currentFields.includes('metadata')) {
          logWarn('Table schema missing fields, attempting to recreate with correct schema', 'VectorStore', {
            missingFields,
            hasMetadataColumn: currentFields.includes('metadata')
          })
          
          // 尝试删除并重新创建表
          try {
            await (table as unknown as { drop: () => Promise<void> }).drop()
            table = await conn.createTable(TABLE_NAME, records, { mode: 'overwrite', schema })
            logInfo('Table recreated with correct schema', 'VectorStore')
          } catch (recreateError) {
            logError('Failed to recreate table', 'VectorStore', undefined, recreateError as Error)
            throw recreateError
          }
        } else {
          // 如果字段都存在，可能是其他问题，尝试 LangChain fallback
          logWarn('Schema appears correct, trying LangChain fallback', 'VectorStore')
          throw error
        }
      }

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
    
    // 处理新增字段 - 只处理实际存在的值，避免空字符串
    const title = doc.metadata?.title ? String(doc.metadata.title) : ''
    const description = doc.metadata?.description ? String(doc.metadata.description) : ''
    const author = doc.metadata?.author ? String(doc.metadata.author) : ''
    const created = doc.metadata?.created ? String(doc.metadata.created) : ''
    const modified = doc.metadata?.modified ? String(doc.metadata.modified) : ''

    const metadata: Record<string, unknown> = {
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
      chunkingStrategy,
      title,
      description,
      author,
      created,
      modified
    }

    // 处理额外字段打包到extra - 序列化为JSON字符串
    const knownFields = [
      'source', 'tags', 'fileName', 'fileType', 'pageNumber', 'position',
      'sourceType', 'importedAt', 'chunkIndex', 'blockTypes', 'hasHeading',
      'headingText', 'chunkingStrategy', 'title', 'description', 'author',
      'created', 'modified'
    ]
    
    const extraFields = Object.keys(doc.metadata || {}).filter(
      field => !knownFields.includes(field)
    )
    
    if (extraFields.length > 0) {
      const extraObj: Record<string, unknown> = {}
      for (const field of extraFields) {
        extraObj[field] = doc.metadata?.[field]
      }
      // 序列化为JSON字符串
      metadata.extra = JSON.stringify(extraObj)
    }

    // 只返回实际存在的顶层字段，避免添加空值字段
    const record: Record<string, unknown> = {
      vector: vectors[i],
      text: doc.pageContent,
      metadata
    }

    // 按需添加非空的顶层字段
    if (source !== null) record.source = source
    if (tags.length > 0) record.tags = tags
    if (fileName !== null) record.fileName = fileName
    if (fileType !== null) record.fileType = fileType
    if (pageNumber !== null) record.pageNumber = pageNumber
    if (position !== null) record.position = position
    if (sourceType !== null) record.sourceType = sourceType
    if (importedAt !== null) record.importedAt = importedAt
    if (chunkIndex !== null) record.chunkIndex = chunkIndex
    if (blockTypes.length > 0) record.blockTypes = blockTypes
    if (hasHeading) record.hasHeading = hasHeading
    if (headingText) record.headingText = headingText
    if (chunkingStrategy !== null) record.chunkingStrategy = chunkingStrategy
    if (title) record.title = title
    if (description) record.description = description
    if (author) record.author = author

    return record
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
