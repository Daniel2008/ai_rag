import fs from 'fs/promises'
import { loadAndSplitFileInWorker } from '../workerManager'
import {
  addDocumentsToStore,
  resetVectorStore,
  ensureEmbeddingsInitialized,
  removeSourceFromStore,
  getDocumentsBySource
} from '../store/index'
import { normalizePath } from '../pathUtils'
import { Document } from '@langchain/core/documents'
import { IndexedFileRecord, KnowledgeBaseSnapshot } from '../../../types/files'
import { ProgressMessage, ProgressStatus, TaskType } from '../progressTypes'
import { getIndexedFileRecords, saveIndexedFileRecords } from './store'
import {
  upsertIndexedFileRecord,
  getSnapshot,
  pruneCollectionsForMissingFiles
} from './core'
import { SmartPromptGenerator } from '../smartFeatures'
import { createHash } from 'crypto'

// 文件哈希缓存，避免重复计算
const fileHashCache = new Map<string, string>()

/**
 * 计算文件内容哈希，用于检测内容是否真正变化
 */
async function calculateFileHash(path: string): Promise<string> {
  try {
    const content = await fs.readFile(path)
    return createHash('md5').update(content).digest('hex')
  } catch (_error) {
    return ''
  }
}

/**
 * 清理文件哈希缓存
 */
export function clearFileHashCache(): void {
  fileHashCache.clear()
}

/**
 * 判断文件是否需要更新
 */
async function needsFileUpdate(record: IndexedFileRecord): Promise<{ needsUpdate: boolean; reason: string }> {
  // URL总是需要更新（可以优化为缓存机制）
  if (
    record.sourceType === 'url' ||
    record.path.startsWith('http://') ||
    record.path.startsWith('https://')
  ) {
    return { needsUpdate: true, reason: 'URL总是重新加载' }
  }

  try {
    const stats = await fs.stat(record.path)
    const currentHash = await calculateFileHash(record.path)

    // 如果哈希缓存中有记录，且与当前一致，则不需要更新
    if (fileHashCache.has(record.path) && fileHashCache.get(record.path) === currentHash) {
      return { needsUpdate: false, reason: '文件内容未变化' }
    }

    // 如果大小或修改时间变化，需要更新
    if (
      record.size !== stats.size ||
      (record.updatedAt && record.updatedAt < stats.mtimeMs)
    ) {
      fileHashCache.set(record.path, currentHash)
      return {
        needsUpdate: true,
        reason: `文件大小或修改时间变化 (size: ${record.size}→${stats.size})`
      }
    }

    // 如果哈希变化，需要更新
    if (record.fileHash && record.fileHash !== currentHash) {
      fileHashCache.set(record.path, currentHash)
      return { needsUpdate: true, reason: '文件内容哈希变化' }
    }

    // 如果没有哈希记录，需要计算并更新
    if (!record.fileHash) {
      fileHashCache.set(record.path, currentHash)
      return { needsUpdate: true, reason: '首次索引，需要计算哈希' }
    }

    return { needsUpdate: false, reason: '文件未变化' }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { needsUpdate: false, reason: '文件不存在' }
    }
    return { needsUpdate: true, reason: `无法检查文件: ${error}` }
  }
}

/**
 * 为文件记录增加智能特性（摘要、要点） - 优化性能
 */
async function enrichFileRecordWithSmartFeatures(
  record: IndexedFileRecord,
  docs: Document[]
): Promise<Partial<IndexedFileRecord>> {
  try {
    // 限制处理的文档数量，避免性能问题
    const sampleContent = docs
      .slice(0, 5)
      .map((d) => d.pageContent)
      .join('\n\n')

    if (sampleContent.length > 100 && sampleContent.length < 5000) {
      const generator = new SmartPromptGenerator()
      const result = await generator.generateSummary(sampleContent, { length: 'short' })
      return {
        summary: result.summary,
        keyPoints: result.keyPoints
      }
    }
  } catch (_error) {
    // 智能特性失败不影响基本索引
  }
  return {}
}

/**
 * 智能增量更新 - 只更新真正变化的部分
 */
async function smartIncrementalUpdate(
  records: IndexedFileRecord[],
  onProgress?: (message: ProgressMessage) => void
): Promise<IndexedFileRecord[]> {
  const { loadFromUrl } = await import('../urlLoader')

  if (onProgress) {
    onProgress({
      status: ProgressStatus.PROCESSING,
      progress: 0,
      message: '正在检查文件变更...',
      taskType: TaskType.MODEL_DOWNLOAD
    })
  }

  await ensureEmbeddingsInitialized((progress) => {
    if (onProgress) onProgress(progress)
  })

  const refreshed: IndexedFileRecord[] = []
  let processedCount = 0
  const total = records.length
  let updatedCount = 0
  let skippedCount = 0

  for (const record of records) {
    try {
      const updateCheck = await needsFileUpdate(record)

      if (!updateCheck.needsUpdate) {
        // 文件未变化，直接保留
        refreshed.push(record)
        skippedCount++
        processedCount++

        if (onProgress && processedCount % 5 === 0) {
          onProgress({
            status: ProgressStatus.PROCESSING,
            progress: Math.round((processedCount / total) * 100),
            message: `检查进度: ${processedCount}/${total} (跳过 ${skippedCount})`,
            taskType: TaskType.DOCUMENT_PARSE
          })
        }
        continue
      }

      // 需要更新
      if (onProgress) {
        onProgress({
          status: ProgressStatus.PROCESSING,
          progress: Math.round((processedCount / total) * 100),
          message: `正在更新: ${record.path} (${updateCheck.reason})`,
          taskType: TaskType.DOCUMENT_PARSE
        })
      }

      let docs: Document[] = []
      let newRecord = { ...record }

      if (record.sourceType === 'url') {
        const result = await loadFromUrl(record.path)
        if (result.success && result.documents) {
          docs = result.documents
          newRecord = {
            ...record,
            chunkCount: docs.length,
            preview: result.content?.slice(0, 160) ?? record.preview,
            updatedAt: Date.now(),
            siteName: result.meta?.siteName || record.siteName,
            fileHash: result.content
              ? createHash('md5').update(result.content).digest('hex')
              : undefined
          }
        }
      } else {
        const stats = await fs.stat(record.path)
        const fileHash = await calculateFileHash(record.path)

        // 检查是否只需要部分更新（增量分块）
        const existingDocs = await getDocumentsBySource(record.path)
        if (existingDocs.length > 0) {
          // 简化的增量更新：先删除旧数据，再添加新数据
          await removeSourceFromStore(record.path)
          console.log(`[增量更新] 删除旧数据: ${record.path}`)
        }

        docs = await loadAndSplitFileInWorker(record.path)
        newRecord = {
          ...record,
          chunkCount: docs.length,
          preview: docs[0]?.pageContent.slice(0, 160) ?? record.preview,
          updatedAt: Date.now(),
          size: stats.size,
          fileHash
        }

        // 更新哈希缓存
        fileHashCache.set(record.path, fileHash)
      }

      if (docs.length > 0) {
        // 注入标签
        if (newRecord.tags && newRecord.tags.length > 0) {
          docs.forEach((doc) => {
            doc.metadata = { ...doc.metadata, tags: newRecord.tags }
          })
        }

        // 智能特性增强
        const smartFeatures = await enrichFileRecordWithSmartFeatures(newRecord, docs)

        // 批量添加到存储
        await addDocumentsToStore(docs, undefined, 0, true)

        refreshed.push({ ...newRecord, ...smartFeatures })
        updatedCount++
      }
    } catch (_e) {
      // 保留原记录，即使更新失败
      refreshed.push(record)
    }

    processedCount++
    if (onProgress) {
      onProgress({
        status: ProgressStatus.PROCESSING,
        progress: Math.round((processedCount / total) * 100),
        message: `更新完成: ${processedCount}/${total} (更新 ${updatedCount}, 跳过 ${skippedCount})`,
        taskType: TaskType.DOCUMENT_PARSE
      })
    }
  }

  // 批量处理完成后的缓存清理
  clearFileHashCache()

  return refreshed
}

/**
 * 高性能全量重建 - 改进的并行处理
 */
async function optimizedRebuildVectorStore(
  records: IndexedFileRecord[],
  onProgress?: (message: ProgressMessage) => void
): Promise<IndexedFileRecord[]> {
  const { loadFromUrl } = await import('../urlLoader')

  if (onProgress) {
    onProgress({
      status: ProgressStatus.PROCESSING,
      progress: 0,
      message: '正在初始化重建...',
      taskType: TaskType.MODEL_DOWNLOAD
    })
  }

  await ensureEmbeddingsInitialized((progress) => {
    if (onProgress) onProgress(progress)
  })

  // 清空现有存储
  await resetVectorStore()

  // 分批处理，避免内存溢出
  const BATCH_SIZE = 10 // 每批处理的文件数
  const results: IndexedFileRecord[] = []
  const allDocs: Document[] = []

  let processedCount = 0
  const total = records.length
  let successfulFiles = 0
  let failedFiles = 0

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE)

    if (onProgress) {
      onProgress({
        status: ProgressStatus.PROCESSING,
        progress: Math.round((processedCount / total) * 100),
        message: `正在解析文档批次 ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(total / BATCH_SIZE)} (成功: ${successfulFiles}, 失败: ${failedFiles})`,
        taskType: TaskType.DOCUMENT_PARSE
      })
    }

    // 并行处理批次中的所有文件
    const batchResults = await Promise.allSettled(
      batch.map(async (record) => {
        try {
          if (
            record.sourceType === 'url' ||
            record.path.startsWith('http://') ||
            record.path.startsWith('https://')
          ) {
            const result = await loadFromUrl(record.path)
            if (result.success && result.documents) {
              const docs = result.documents.map((d) => {
                d.metadata = { ...d.metadata, tags: record.tags, source: record.path }
                return d
              })
              return {
                record: {
                  ...record,
                  chunkCount: result.documents.length,
                  preview: result.content?.slice(0, 160) ?? record.preview,
                  updatedAt: Date.now(),
                  sourceType: 'url' as const,
                  siteName: result.meta?.siteName || record.siteName,
                  fileHash: result.content
                    ? createHash('md5').update(result.content).digest('hex')
                    : undefined
                },
                docs
              }
            }
            throw new Error(result.error || 'URL加载失败')
          } else {
            // 检查文件是否存在
            try {
              await fs.access(record.path)
            } catch {
              throw new Error('文件不存在')
            }

            const stats = await fs.stat(record.path)
            const docs = await loadAndSplitFileInWorker(record.path)
            
            // 确保文档有正确的source和tags
            const enrichedDocs = docs.map((d) => {
              d.metadata = { 
                ...d.metadata, 
                tags: record.tags || [],
                source: record.path
              }
              return d
            })
            
            const fileHash = await calculateFileHash(record.path)

            return {
              record: {
                ...record,
                chunkCount: enrichedDocs.length,
                preview: enrichedDocs[0]?.pageContent.slice(0, 160) ?? record.preview,
                updatedAt: Date.now(),
                sourceType: 'file' as const,
                size: stats.size,
                fileHash
              },
              docs: enrichedDocs
            }
          }
        } catch (error) {
          console.error(`[重建] 处理文件失败: ${record.path}`, error)
          throw error
        }
      })
    )

    // 处理批次结果
    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j]
      const originalRecord = batch[j]
      
      if (result.status === 'fulfilled' && result.value) {
        results.push(result.value.record)
        allDocs.push(...result.value.docs)
        successfulFiles++
      } else {
        failedFiles++
        console.warn(`[重建] 跳过失败文件: ${originalRecord.path}`)
        // 保留原始记录以便后续分析
        results.push(originalRecord)
      }
    }

    processedCount += batch.length
  }

  // 记录重建统计
  console.log(`[重建] 完成统计: 总文件${total}, 成功${successfulFiles}, 失败${failedFiles}, 文档总数${allDocs.length}`)

  // 高性能批量索引
  if (allDocs.length > 0) {
    // 分批添加到存储，每批50个文档
    const DOC_BATCH_SIZE = 50
    for (let i = 0; i < allDocs.length; i += DOC_BATCH_SIZE) {
      const docBatch = allDocs.slice(i, i + DOC_BATCH_SIZE)
      const progressStart = 30 + (i / allDocs.length) * 70

      await addDocumentsToStore(
        docBatch,
        (progress) => {
          if (onProgress && progress.progress !== undefined) {
            const overallProgress = Math.round(
              progressStart + (progress.progress / 100) * (70 / (allDocs.length / DOC_BATCH_SIZE))
            )
            onProgress({
              status: ProgressStatus.PROCESSING,
              progress: overallProgress,
              message: `正在索引向量: ${Math.min(i + docBatch.length, allDocs.length)}/${allDocs.length}`,
              taskType: TaskType.EMBEDDING_GENERATION
            })
          }
        },
        progressStart,
        false
      )
    }
  } else if (onProgress) {
    onProgress({
      status: ProgressStatus.COMPLETED,
      progress: 100,
      message: '重建完成',
      taskType: TaskType.INDEX_REBUILD
    })
  }

  // 清理缓存
  clearFileHashCache()

  return results
}

/**
 * 快速增量更新 - 适用于日常维护
 */
async function fastIncrementalUpdate(
  records: IndexedFileRecord[],
  onProgress?: (message: ProgressMessage) => void
): Promise<IndexedFileRecord[]> {
  const { loadFromUrl } = await import('../urlLoader')

  await ensureEmbeddingsInitialized((progress) => {
    if (onProgress) onProgress(progress)
  })

  const refreshed: IndexedFileRecord[] = []
  let processedCount = 0
  const total = records.length
  let updatedCount = 0

  for (const record of records) {
    try {
      if (record.sourceType === 'file') {
        try {
          const stats = await fs.stat(record.path)
          // 只检查大小和修改时间（快速检查）
          if (
            record.size !== stats.size ||
            (record.updatedAt && record.updatedAt < stats.mtimeMs)
          ) {
            // 删除旧数据
            await removeSourceFromStore(record.path)

            // 重新索引
            const docs = await loadAndSplitFileInWorker(record.path)
            const newRecord: IndexedFileRecord = {
              ...record,
              chunkCount: docs.length,
              preview: docs[0]?.pageContent.slice(0, 160) ?? record.preview,
              updatedAt: Date.now(),
              size: stats.size
            }

            if (docs.length > 0) {
              if (newRecord.tags && newRecord.tags.length > 0) {
                docs.forEach((doc) => {
                  doc.metadata = { ...doc.metadata, tags: newRecord.tags }
                })
              }

              await addDocumentsToStore(docs)
              const smartFeatures = await enrichFileRecordWithSmartFeatures(newRecord, docs)
              refreshed.push({ ...newRecord, ...smartFeatures })
              updatedCount++
            }
          } else {
            refreshed.push(record)
          }
        } catch (_e) {
          // 文件不存在，跳过
          processedCount++
          continue
        }
      } else if (record.sourceType === 'url') {
        // URL总是重新索引
        // 删除旧数据
        await removeSourceFromStore(record.path)

        // 重新索引
        const result = await loadFromUrl(record.path)
        if (result.success && result.documents) {
          const docs = result.documents
          const newRecord: IndexedFileRecord = {
            ...record,
            chunkCount: docs.length,
            preview: result.content?.slice(0, 160) ?? record.preview,
            updatedAt: Date.now(),
            siteName: result.meta?.siteName || record.siteName
          }

          if (docs.length > 0) {
            if (newRecord.tags && newRecord.tags.length > 0) {
              docs.forEach((doc) => {
                doc.metadata = { ...doc.metadata, tags: newRecord.tags }
              })
            }

            await addDocumentsToStore(docs)
            const smartFeatures = await enrichFileRecordWithSmartFeatures(newRecord, docs)
            refreshed.push({ ...newRecord, ...smartFeatures })
            updatedCount++
          }
        } else {
          refreshed.push(record)
        }
      } else {
        // 其他类型，直接保留
        refreshed.push(record)
      }
    } catch (e) {
      console.error(`Error processing record ${record.path}:`, e)
      refreshed.push(record)
    }

    processedCount++
    if (onProgress && processedCount % 3 === 0) {
      onProgress({
        status: ProgressStatus.PROCESSING,
        progress: Math.round((processedCount / total) * 100),
        message: `快速增量: ${processedCount}/${total} (更新 ${updatedCount})`,
        taskType: TaskType.DOCUMENT_PARSE
      })
    }
  }

  return refreshed
}

/**
 * 刷新知识库 - 支持两种模式：智能增量和高性能全量
 */
export async function refreshKnowledgeBase(
  onProgress?: (message: ProgressMessage) => void,
  incremental: boolean = true,
  mode: 'smart' | 'fast' = 'smart'
): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()

  if (records.length === 0) {
    if (onProgress) {
      onProgress({
        status: ProgressStatus.COMPLETED,
        progress: 100,
        message: '知识库为空，无需处理',
        taskType: TaskType.INDEX_REBUILD
      })
    }
    return getSnapshot()
  }

  let refreshed: IndexedFileRecord[]

  if (incremental) {
    if (mode === 'smart') {
      refreshed = await smartIncrementalUpdate(records, onProgress)
    } else {
      // 快速增量：跳过哈希检查，只检查文件存在性和大小
      refreshed = await fastIncrementalUpdate(records, onProgress)
    }
  } else {
    refreshed = await optimizedRebuildVectorStore(records, onProgress)
  }

  saveIndexedFileRecords(refreshed)
  pruneCollectionsForMissingFiles()

  // 清理哈希缓存
  clearFileHashCache()

  if (onProgress) {
    onProgress({
      status: ProgressStatus.COMPLETED,
      progress: 100,
      message: '知识库刷新完成',
      taskType: TaskType.INDEX_REBUILD
    })
  }

  return getSnapshot()
}

/**
 * 重新索引单个文件 - 原子操作，支持事务
 */
export async function reindexSingleFile(path: string): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const nPath = normalizePath(path)
  const target = records.find(
    (record) => (record.normalizedPath ?? normalizePath(record.path)) === nPath
  )

  if (!target) {
    throw new Error('找不到需要重新索引的文档')
  }

  const { loadFromUrl } = await import('../urlLoader')

  // 原子操作：先准备数据，再删除旧数据，最后添加新数据
  try {
    let docs: Document[] = []
    let newRecord: IndexedFileRecord

    if (target.sourceType === 'url' || path.startsWith('http://') || path.startsWith('https://')) {
      const result = await loadFromUrl(path)
      if (!result.success || !result.documents) {
        throw new Error(result.error || 'URL 内容获取失败')
      }
      docs = result.documents
      newRecord = {
        ...target,
        ...(await enrichFileRecordWithSmartFeatures(target, docs)),
        chunkCount: docs.length,
        preview: result.content?.slice(0, 160) ?? target.preview,
        updatedAt: Date.now(),
        sourceType: 'url',
        siteName: result.meta?.siteName || target.siteName,
        fileHash: result.content ? createHash('md5').update(result.content).digest('hex') : undefined
      }
    } else {
      await fs.access(path)
      const stats = await fs.stat(path)
      docs = await loadAndSplitFileInWorker(path)
      const fileHash = await calculateFileHash(path)

      newRecord = {
        ...target,
        ...(await enrichFileRecordWithSmartFeatures(target, docs)),
        chunkCount: docs.length,
        preview: docs[0]?.pageContent.slice(0, 160) ?? target.preview,
        updatedAt: Date.now(),
        sourceType: 'file',
        size: stats.size,
        fileHash
      }
    }

    // 注入标签
    if (target.tags && target.tags.length > 0) {
      docs.forEach((doc) => {
        doc.metadata = { ...doc.metadata, tags: target.tags }
      })
    }

    // 原子替换：先删除旧数据，再添加新数据
    if (docs.length > 0) {
      await removeSourceFromStore(path)
      await addDocumentsToStore(docs)
      upsertIndexedFileRecord(newRecord)
    }

    pruneCollectionsForMissingFiles()
    return getSnapshot()
  } catch (error) {
    console.error('单文件重新索引失败:', error)
    throw new Error(`重新索引失败: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearFileHashCache()
  }
}

/**
 * 获取索引状态统计
 */
export async function getIndexingStats(): Promise<{
  totalFiles: number
  totalChunks: number
  lastUpdate: number
  pendingUpdates: number
  failedFiles: string[]
}> {
  const records = getIndexedFileRecords()
  const totalChunks = records.reduce((sum, r) => sum + (r.chunkCount || 0), 0)

  // 检查需要更新的文件
  let pendingUpdates = 0
  const failedFiles: string[] = []

  for (const record of records) {
    const check = await needsFileUpdate(record)
    if (check.needsUpdate) {
      pendingUpdates++
    }
    // 检查是否为异常记录
    if (record.chunkCount === 0 || !record.updatedAt) {
      failedFiles.push(record.path)
    }
  }

  return {
    totalFiles: records.length,
    totalChunks,
    lastUpdate: Math.max(...records.map((r) => r.updatedAt || 0), 0),
    pendingUpdates,
    failedFiles
  }
}

/**
 * 批量清理无效记录
 */
export async function cleanupInvalidRecords(): Promise<number> {
  const records = getIndexedFileRecords()
  const validRecords: IndexedFileRecord[] = []

  for (const record of records) {
    if (record.sourceType === 'file') {
      try {
        await fs.access(record.path)
        validRecords.push(record)
      } catch (_e) {
        // 文件不存在，移除记录
        await removeSourceFromStore(record.path)
      }
    } else {
      // URL暂时保留
      validRecords.push(record)
    }
  }

  if (validRecords.length !== records.length) {
    saveIndexedFileRecords(validRecords)
    pruneCollectionsForMissingFiles()
  }

  return records.length - validRecords.length
}
