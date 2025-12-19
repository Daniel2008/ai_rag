import { Document } from '@langchain/core/documents'
import { LocalEmbeddings } from '../localEmbeddings'
import { ProgressStatus, TaskType } from '../progressTypes'
import { logInfo, logError, logWarn, logDebug } from '../../utils/logger'
import { memoryMonitor } from '../../utils/memoryMonitor'
import { createProcessingProgress, createCompletedMessage } from '../../utils/progressHelper'
import { getEmbeddings } from './embeddings'
import {
  ensureTableWithDocuments,
  initVectorStore,
  resetVectorStore,
  TABLE_NAME,
  db,
  table,
  setTable,
  setVectorStore
} from './core'
import { invalidateDocCountCache } from './query_cache'
import { clearBM25Cache } from './bm25'
import { normalizePath, escapePredicateValue } from './utils'
import type { ProgressCallback } from './types'
import type { Connection, Table } from '@lancedb/lancedb'
import path from 'path'

/**
 * 添加文档到存储
 */
export async function addDocumentsToStore(
  docs: Document[],
  onProgress?: ProgressCallback,
  startProgress: number = 0,
  appendMode: boolean = true
): Promise<void> {
  if (docs.length === 0) return

  memoryMonitor.checkMemoryThreshold()

  const progressRange = 100 - startProgress
  const progressMsg = createProcessingProgress(
    TaskType.INDEX_REBUILD,
    startProgress,
    '正在索引文档...'
  )
  onProgress?.(progressMsg)

  const embeddings = getEmbeddings()
  if (embeddings instanceof LocalEmbeddings) {
    embeddings.setTempProgressCallback((progress) => {
      if (progress.status === ProgressStatus.DOWNLOADING) {
        onProgress?.({
          ...progress,
          taskType: progress.taskType || TaskType.MODEL_DOWNLOAD
        })
      } else if (progress.status === ProgressStatus.PROCESSING && progress.progress !== undefined) {
        const adjustedProgress = Math.round(
          startProgress + (progress.progress / 100) * progressRange
        )
        onProgress?.(
          createProcessingProgress(
            TaskType.EMBEDDING_GENERATION,
            adjustedProgress,
            `正在生成向量 ${adjustedProgress}%`
          )
        )
      } else {
        onProgress?.(progress)
      }
    })
  }

  try {
    const store = await ensureTableWithDocuments(docs, appendMode)
    setVectorStore(store)
    onProgress?.(createCompletedMessage(TaskType.INDEX_REBUILD, '索引完成'))
    logInfo(`Added ${docs.length} documents to LanceDB`, 'VectorStore')
    invalidateDocCountCache()
    clearBM25Cache()
  } catch (error) {
    logError(
      'Failed to add documents, trying to recreate table',
      'VectorStore',
      undefined,
      error as Error
    )
    await resetVectorStore()
    const store = await ensureTableWithDocuments(docs, false)
    setVectorStore(store)
    onProgress?.(createCompletedMessage(TaskType.INDEX_REBUILD, '索引完成（已重建）'))
    logInfo(`Recreated LanceDB table and added ${docs.length} documents`, 'VectorStore')
    invalidateDocCountCache()
  } finally {
    if (embeddings instanceof LocalEmbeddings) {
      embeddings.setTempProgressCallback(undefined)
    }
  }
}

/**
 * 从存储中删除单个源
 */
export async function removeSourceFromStore(source: string): Promise<void> {
  await initVectorStore()
  if (!db) {
    logWarn('Database not initialized, cannot remove source', 'VectorStore', { source })
    return
  }

  const conn = db as Connection
  let currentTable: Table | null = null

  const names = await conn.tableNames()
  if (!names.includes(TABLE_NAME)) {
    logInfo('Table does not exist, nothing to remove', 'VectorStore', { source })
    return
  }
  currentTable = await conn.openTable(TABLE_NAME)
  setTable(currentTable)

  const normalizedSource = normalizePath(source)
  const forwardSlash = source.replace(/\\/g, '/')
  const backSlash = source.replace(/\//g, '\\')
  const pathNormalized = path.normalize(source)

  const sourceVariants = [
    source,
    normalizedSource,
    forwardSlash,
    backSlash,
    pathNormalized,
    forwardSlash.toLowerCase(),
    backSlash.toLowerCase()
  ]

  const uniqueVariants = [...new Set(sourceVariants)]

  logInfo('Removing source from vector store', 'VectorStore', {
    originalSource: source,
    normalizedSource,
    variantsCount: uniqueVariants.length
  })

  let successfulDeletes = 0
  let lastError: Error | null = null

  for (const variant of uniqueVariants) {
    const escapedVariant = escapePredicateValue(variant)
    const predicate = `source == "${escapedVariant}"`

    try {
      await (currentTable as unknown as { delete: (where: string) => Promise<void> }).delete(
        predicate
      )
      successfulDeletes++
      logDebug('Delete executed with predicate', 'VectorStore', { predicate })
    } catch (e) {
      lastError = e as Error
      const errMsg = String(e)
      if (!errMsg.includes('no rows') && !errMsg.includes('not found')) {
        logDebug('Delete failed with predicate', 'VectorStore', { predicate, error: errMsg })
      }
    }
  }

  invalidateDocCountCache()
  clearBM25Cache()

  logInfo('Source removal completed', 'VectorStore', {
    source,
    successfulDeletes,
    lastError: lastError?.message
  })
}

/**
 * 从存储中批量删除源
 */
export async function removeSourcesFromStore(sources: string[]): Promise<void> {
  if (sources.length === 0) return

  logInfo(`Removing ${sources.length} sources from vector store`, 'VectorStore', {
    sources: sources.slice(0, 5)
  })

  await initVectorStore()
  const currentTable = table
  if (!db || !currentTable) {
    logWarn('Database or table not initialized, falling back to individual removal', 'VectorStore')
    for (const source of sources) {
      await removeSourceFromStore(source)
    }
    return
  }

  try {
    const allVariants: string[] = []
    for (const source of sources) {
      const normalizedSource = normalizePath(source)
      const forwardSlash = source.replace(/\\/g, '/')
      allVariants.push(source, normalizedSource, forwardSlash)
    }
    const uniqueVariants = [...new Set(allVariants)]
    const escapedVariants = uniqueVariants.map((v) => `"${escapePredicateValue(v)}"`)

    const inClause = escapedVariants.join(', ')
    const batchPredicate = `source IN (${inClause})`

    logDebug('Executing batch delete', 'VectorStore', {
      variantCount: uniqueVariants.length,
      predicateLength: batchPredicate.length
    })

    await (currentTable as unknown as { delete: (where: string) => Promise<void> }).delete(
      batchPredicate
    )

    invalidateDocCountCache()
    clearBM25Cache()

    logInfo('Batch delete completed successfully', 'VectorStore', { sourceCount: sources.length })
    return
  } catch (batchError) {
    logWarn(
      'Batch delete failed, falling back to individual removal',
      'VectorStore',
      undefined,
      batchError as Error
    )
  }

  for (const source of sources) {
    try {
      await removeSourceFromStore(source)
    } catch (e) {
      logWarn('Failed to remove source', 'VectorStore', { source }, e as Error)
    }
  }

  invalidateDocCountCache()
  clearBM25Cache()
}
