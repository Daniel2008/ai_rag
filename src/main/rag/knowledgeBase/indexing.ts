import fs from 'fs/promises'
import { loadAndSplitFileInWorker } from '../workerManager'
import { addDocumentsToStore, resetVectorStore, ensureEmbeddingsInitialized } from '../store/index'
import { normalizePath } from '../pathUtils'
import { Document } from '@langchain/core/documents'
import { IndexedFileRecord, KnowledgeBaseSnapshot } from '../../../types/files'
import { ProgressMessage, ProgressStatus, TaskType } from '../progressTypes'
import { getIndexedFileRecords, saveIndexedFileRecords } from './store'
import { upsertIndexedFileRecord, getSnapshot, pruneCollectionsForMissingFiles } from './core'
import { removeSourceFromStore } from '../store/index'
import { SmartPromptGenerator } from '../smartFeatures'

export async function refreshKnowledgeBase(
  onProgress?: (message: ProgressMessage) => void,
  incremental: boolean = true
): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const refreshed = incremental
    ? await incrementalUpdateVectorStore(records, onProgress)
    : await rebuildVectorStore(records, onProgress)

  saveIndexedFileRecords(refreshed)
  pruneCollectionsForMissingFiles()
  return getSnapshot()
}

export async function reindexSingleFile(path: string): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const nPath = normalizePath(path)
  const target = records.find(
    (record) => (record.normalizedPath ?? normalizePath(record.path)) === nPath
  )
  if (!target) {
    throw new Error('找不到需要重新索引的文档')
  }
  await removeSourceFromStore(path)

  if (target.sourceType === 'url' || path.startsWith('http://') || path.startsWith('https://')) {
    const { loadFromUrl } = await import('../urlLoader')
    const result = await loadFromUrl(path)
    if (result.success && result.documents) {
      await addDocumentsToStore(result.documents)
      const smartFeatures = await enrichFileRecordWithSmartFeatures(target, result.documents)
      upsertIndexedFileRecord({
        ...target,
        ...smartFeatures,
        chunkCount: result.documents.length,
        preview: result.content?.slice(0, 160) ?? target.preview,
        updatedAt: Date.now(),
        sourceType: 'url',
        siteName: result.meta?.siteName || target.siteName
      })
    } else {
      throw new Error(result.error || 'URL 内容获取失败')
    }
  } else {
    await fs.access(path)
    const docs = await loadAndSplitFileInWorker(path)

    // 注入标签
    if (target.tags && target.tags.length > 0) {
      docs.forEach((doc) => {
        doc.metadata = { ...doc.metadata, tags: target.tags }
      })
    }

    await addDocumentsToStore(docs)
    const smartFeatures = await enrichFileRecordWithSmartFeatures(target, docs)
    upsertIndexedFileRecord({
      ...target,
      ...smartFeatures,
      chunkCount: docs.length,
      preview: docs[0]?.pageContent.slice(0, 160) ?? target.preview,
      updatedAt: Date.now(),
      sourceType: 'file'
    })
  }

  pruneCollectionsForMissingFiles()
  return getSnapshot()
}

/**
 * 为文件记录增加智能特性（摘要、要点）
 */
async function enrichFileRecordWithSmartFeatures(
  _record: IndexedFileRecord,
  docs: Document[]
): Promise<Partial<IndexedFileRecord>> {
  try {
    const generator = new SmartPromptGenerator()
    const content = docs
      .slice(0, 10)
      .map((d) => d.pageContent)
      .join('\n\n')

    if (content.length > 100) {
      const result = await generator.generateSummary(content, { length: 'short' })
      return {
        summary: result.summary,
        keyPoints: result.keyPoints
      }
    }
  } catch (_e) {
    // 忽略错误，不影响基本索引
  }
  return {}
}

async function incrementalUpdateVectorStore(
  records: IndexedFileRecord[],
  onProgress?: (message: ProgressMessage) => void
): Promise<IndexedFileRecord[]> {
  const { loadFromUrl } = await import('../urlLoader')

  if (onProgress) {
    onProgress({
      status: ProgressStatus.PROCESSING,
      progress: 0,
      message: '正在初始化...',
      taskType: TaskType.MODEL_DOWNLOAD
    })
  }

  await ensureEmbeddingsInitialized((progress) => {
    if (onProgress) onProgress(progress)
  })

  const refreshed: IndexedFileRecord[] = []
  let processedCount = 0
  const total = records.length

  for (const record of records) {
    try {
      let needsUpdate = false
      let stats: import('fs').Stats | null = null

      if (record.sourceType === 'file') {
        try {
          stats = await fs.stat(record.path)
          // 如果 size 变化或 mtime 变化，则需要更新
          if (
            record.size !== stats.size ||
            (record.updatedAt && record.updatedAt < stats.mtimeMs)
          ) {
            needsUpdate = true
          }
        } catch (_e) {
          // 文件不存在，跳过该记录
          processedCount++
          continue
        }
      } else {
        // URL 暂不支持增量判断，每次都更新
        needsUpdate = true
      }

      if (needsUpdate) {
        // 先删除旧的
        await removeSourceFromStore(record.path)

        // 再索引新的
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
              siteName: result.meta?.siteName || record.siteName
            }
          }
        } else {
          docs = await loadAndSplitFileInWorker(record.path)
          const fileSize = stats?.size ?? record.size
          newRecord = {
            ...record,
            chunkCount: docs.length,
            preview: docs[0]?.pageContent.slice(0, 160) ?? record.preview,
            updatedAt: Date.now(),
            size: fileSize
          }
        }

        if (docs.length > 0) {
          // 注入标签
          if (newRecord.tags && newRecord.tags.length > 0) {
            docs.forEach((doc) => {
              doc.metadata = { ...doc.metadata, tags: newRecord.tags }
            })
          }

          await addDocumentsToStore(docs)
          const smartFeatures = await enrichFileRecordWithSmartFeatures(newRecord, docs)
          refreshed.push({ ...newRecord, ...smartFeatures })
        }
      } else {
        // 不需要更新，直接保留
        refreshed.push(record)
      }
    } catch (e) {
      console.error(`Error updating record ${record.path}:`, e)
    }

    processedCount++
    if (onProgress) {
      onProgress({
        status: ProgressStatus.PROCESSING,
        progress: Math.round((processedCount / total) * 100),
        message: `正在检查增量更新 (${processedCount}/${total})`,
        taskType: TaskType.DOCUMENT_PARSE
      })
    }
  }

  return refreshed
}

async function rebuildVectorStore(
  records: IndexedFileRecord[],
  onProgress?: (message: ProgressMessage) => void
): Promise<IndexedFileRecord[]> {
  const { loadFromUrl } = await import('../urlLoader')

  if (onProgress) {
    onProgress({
      status: ProgressStatus.PROCESSING,
      progress: 0,
      message: '正在检查模型...',
      taskType: TaskType.MODEL_DOWNLOAD
    })
  }

  await ensureEmbeddingsInitialized((progress) => {
    if (onProgress) {
      onProgress(progress)
    }
  })

  // 这里的逻辑可以优化为增量更新，但目前为了保持与原逻辑一致先全量重置
  // 如果要实现增量，需要对比文件指纹或修改时间
  await resetVectorStore()

  let processedCount = 0
  const total = records.length

  const results = await Promise.all(
    records.map(async (record) => {
      try {
        let resultItem: { record: IndexedFileRecord; docs: Document[] } | null = null

        if (
          record.sourceType === 'url' ||
          record.path.startsWith('http://') ||
          record.path.startsWith('https://')
        ) {
          try {
            const result = await loadFromUrl(record.path)
            if (result.success && result.documents) {
              resultItem = {
                record: {
                  ...record,
                  chunkCount: result.documents.length,
                  preview: result.content?.slice(0, 160) ?? record.preview,
                  updatedAt: Date.now(),
                  sourceType: 'url' as const,
                  siteName: result.meta?.siteName || record.siteName
                },
                docs: result.documents.map((d) => {
                  d.metadata = { ...d.metadata, tags: record.tags }
                  return d
                })
              }
            } else {
              resultItem = { record, docs: [] }
            }
          } catch (_err) {
            resultItem = { record, docs: [] }
          }
        } else {
          try {
            await fs.access(record.path)
            const stats = await fs.stat(record.path)

            // 可以在这里做增量判断，如果 mtime 和 size 没变，且向量库里有数据，则跳过
            // 但因为上面调用了 resetVectorStore，所以这里必须重新索引

            const docs = await loadAndSplitFileInWorker(record.path)
            resultItem = {
              record: {
                ...record,
                chunkCount: docs.length,
                preview: docs[0]?.pageContent.slice(0, 160) ?? record.preview,
                updatedAt: Date.now(),
                sourceType: 'file' as const,
                size: stats.size
              },
              docs: docs.map((d) => {
                d.metadata = { ...d.metadata, tags: record.tags }
                return d
              })
            }
          } catch (error) {
            if ((error as { code?: string }).code === 'ENOENT') {
              resultItem = null
            } else {
              resultItem = null
            }
          }
        }

        processedCount++
        if (onProgress) {
          const percent = Math.round((processedCount / total) * 30)
          onProgress({
            status: ProgressStatus.PROCESSING,
            progress: percent,
            message: `正在解析文档 (${processedCount}/${total})`,
            taskType: TaskType.DOCUMENT_PARSE
          })
        }

        return resultItem
      } catch (_e) {
        processedCount++
        return null
      }
    })
  )

  const refreshed: IndexedFileRecord[] = []
  const pendingDocs: Document[] = []

  for (const res of results) {
    if (!res) continue
    refreshed.push(res.record)
    pendingDocs.push(...res.docs)
  }

  if (pendingDocs.length > 0) {
    await addDocumentsToStore(pendingDocs, onProgress, 30, false)
  } else if (onProgress) {
    onProgress({
      status: ProgressStatus.COMPLETED,
      progress: 100,
      message: '重建完成',
      taskType: TaskType.INDEX_REBUILD
    })
  }
  return refreshed
}
