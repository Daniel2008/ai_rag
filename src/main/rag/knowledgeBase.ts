import ElectronStore from 'electron-store'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { loadAndSplitFileInWorker } from './workerManager'
import {
  addDocumentsToStore,
  resetVectorStore,
  removeSourceFromStore,
  ensureEmbeddingsInitialized
} from './store'
import type { Document } from '@langchain/core/documents'
import type {
  DocumentCollection,
  IndexedFileRecord,
  KnowledgeBaseSnapshot
} from '../../types/files'
import { ProgressMessage, ProgressStatus, TaskType } from './progressTypes'

interface KnowledgeBaseStoreShape {
  files: IndexedFileRecord[]
  collections: DocumentCollection[]
}

const StoreConstructor = ((ElectronStore as unknown as { default?: typeof ElectronStore })
  .default ?? ElectronStore) as typeof ElectronStore

const storeConfig: Record<string, unknown> = {
  name: 'knowledge-base',
  projectName: 'ai-rag-app',
  defaults: { files: [], collections: [] }
}
const store = new (StoreConstructor as new (
  config: Record<string, unknown>
) => ElectronStore<KnowledgeBaseStoreShape>)(storeConfig)

export function getIndexedFileRecords(): IndexedFileRecord[] {
  return store.get('files')
}

function saveIndexedFileRecords(records: IndexedFileRecord[]): void {
  store.set('files', records)
}

export function getDocumentCollections(): DocumentCollection[] {
  return store.get('collections')
}

function saveDocumentCollections(collections: DocumentCollection[]): void {
  store.set('collections', collections)
}

function getSnapshot(): KnowledgeBaseSnapshot {
  return {
    files: getIndexedFileRecords().map((record) => ({
      ...record,
      status: 'ready' as const // 为每个记录添加默认的status属性
    })),
    collections: getDocumentCollections()
  }
}

function sanitizeCollectionFiles(files: string[] = []): string[] {
  const validPaths = new Set(getIndexedFileRecords().map((record) => record.path))
  return [...new Set(files.filter((path) => validPaths.has(path)))]
}

function pruneCollectionsForMissingFiles(): void {
  const validPaths = new Set(getIndexedFileRecords().map((record) => record.path))
  const collections = getDocumentCollections().map((collection) => ({
    ...collection,
    files: collection.files.filter((path) => validPaths.has(path))
  }))
  saveDocumentCollections(collections)
}

function removeFileFromCollections(path: string): void {
  const collections = getDocumentCollections().map((collection) => ({
    ...collection,
    files: collection.files.filter((filePath) => filePath !== path)
  }))
  saveDocumentCollections(collections)
}

export function getKnowledgeBaseSnapshot(): KnowledgeBaseSnapshot {
  pruneCollectionsForMissingFiles()
  return getSnapshot()
}

export function upsertIndexedFileRecord(record: IndexedFileRecord): void {
  const records = getIndexedFileRecords()
  const index = records.findIndex((item) => item.path === record.path)
  if (index >= 0) {
    records[index] = { ...records[index], ...record }
  } else {
    records.push(record)
  }
  saveIndexedFileRecords(records)
}

export async function removeIndexedFileRecord(path: string): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const filtered = records.filter((item) => item.path !== path)
  if (filtered.length === records.length) {
    return getSnapshot()
  }
  saveIndexedFileRecords(filtered)
  removeFileFromCollections(path)
  try {
    await removeSourceFromStore(path)
  } catch (e) {
    console.warn('Failed to remove source from store:', e)
  }
  pruneCollectionsForMissingFiles()
  return getSnapshot()
}

export async function refreshKnowledgeBase(
  onProgress?: (message: ProgressMessage) => void
): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const refreshed = await rebuildVectorStore(records, onProgress)
  saveIndexedFileRecords(refreshed)
  pruneCollectionsForMissingFiles()
  return getSnapshot()
}

export async function reindexSingleFile(path: string): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const target = records.find((record) => record.path === path)
  if (!target) {
    throw new Error('找不到需要重新索引的文档')
  }
  await removeSourceFromStore(path)

  if (target.sourceType === 'url' || path.startsWith('http://') || path.startsWith('https://')) {
    const { loadFromUrl } = await import('./urlLoader')
    const result = await loadFromUrl(path)
    if (result.success && result.documents) {
      await addDocumentsToStore(result.documents)
      upsertIndexedFileRecord({
        ...target,
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
    await addDocumentsToStore(docs)
    upsertIndexedFileRecord({
      ...target,
      chunkCount: docs.length,
      preview: docs[0]?.pageContent.slice(0, 160) ?? target.preview,
      updatedAt: Date.now(),
      sourceType: 'file'
    })
  }

  pruneCollectionsForMissingFiles()
  return getSnapshot()
}

export function createDocumentCollection(options: {
  name: string
  description?: string
  files?: string[]
}): KnowledgeBaseSnapshot {
  const collections = getDocumentCollections()
  const now = Date.now()
  const collection: DocumentCollection = {
    id: randomUUID(),
    name: options.name?.trim() || `未命名文档集 ${collections.length + 1}`,
    description: options.description?.trim() || undefined,
    files: sanitizeCollectionFiles(options.files),
    createdAt: now,
    updatedAt: now
  }
  collections.push(collection)
  saveDocumentCollections(collections)
  return getSnapshot()
}

export function updateDocumentCollection(
  id: string,
  updates: { name?: string; description?: string; files?: string[] }
): KnowledgeBaseSnapshot {
  const collections = getDocumentCollections()
  const index = collections.findIndex((collection) => collection.id === id)
  if (index < 0) {
    throw new Error('找不到需要更新的文档集')
  }
  const target = collections[index]
  collections[index] = {
    ...target,
    name: updates.name?.trim() ? updates.name.trim() : target.name,
    description:
      updates.description !== undefined
        ? updates.description?.trim() || undefined
        : target.description,
    files: updates.files !== undefined ? sanitizeCollectionFiles(updates.files) : target.files,
    updatedAt: Date.now()
  }
  saveDocumentCollections(collections)
  return getSnapshot()
}

export function deleteDocumentCollection(id: string): KnowledgeBaseSnapshot {
  const collections = getDocumentCollections().filter((collection) => collection.id !== id)
  saveDocumentCollections(collections)
  return getSnapshot()
}

async function rebuildVectorStore(
  records: IndexedFileRecord[],
  onProgress?: (message: ProgressMessage) => void
): Promise<IndexedFileRecord[]> {
  // 动态导入 URL 加载器（避免循环依赖）
  const { loadFromUrl } = await import('./urlLoader')

  // 阶段0：初始化模型 (0-5%)
  if (onProgress) {
    onProgress({
      status: ProgressStatus.PROCESSING,
      progress: 0,
      message: '正在检查模型...',
      taskType: TaskType.MODEL_DOWNLOAD
    })
  }

  // 确保模型已加载（可能会触发下载）
  await ensureEmbeddingsInitialized((progress) => {
    if (onProgress) {
      // 这里的进度主要是模型下载
      onProgress(progress)
    }
  })

  await resetVectorStore()

  let processedCount = 0
  const total = records.length

  // 并发处理所有记录
  const results = await Promise.all(
    records.map(async (record) => {
      try {
        let resultItem: { record: IndexedFileRecord; docs: Document[] } | null = null

        // 处理 URL 类型的记录
        if (
          record.sourceType === 'url' ||
          record.path.startsWith('http://') ||
          record.path.startsWith('https://')
        ) {
          try {
            console.log('重建 URL 索引:', record.path)
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
                docs: result.documents
              }
            } else {
              console.warn('URL 内容获取失败，保留原记录:', record.path, result.error)
              resultItem = { record, docs: [] }
            }
          } catch (err) {
            console.error('重建 URL 索引失败:', record.path, err)
            resultItem = { record, docs: [] }
          }
        } else {
          // 处理本地文件
          try {
            await fs.access(record.path)
            const docs = await loadAndSplitFileInWorker(record.path)
            resultItem = {
              record: {
                ...record,
                chunkCount: docs.length,
                preview: docs[0]?.pageContent.slice(0, 160) ?? record.preview,
                updatedAt: Date.now(),
                sourceType: 'file' as const
              },
              docs
            }
          } catch (error) {
            // 文件不存在，跳过（移除）
            if ((error as { code?: string }).code === 'ENOENT') {
              console.warn('文件不存在，已从知识库移除:', record.path, error)
              resultItem = null
            } else {
              console.error('重建知识库时处理文件失败:', record.path, error)
              resultItem = null // 处理失败也移除，保持与原逻辑一致
            }
          }
        }

        processedCount++
        if (onProgress) {
          // 阶段1：解析文档 (0-30%)
          const percent = Math.round((processedCount / total) * 30)
          onProgress({
            status: ProgressStatus.PROCESSING,
            progress: percent,
            message: `正在解析文档 (${processedCount}/${total})`,
            taskType: TaskType.DOCUMENT_PARSE
          })
        }

        return resultItem
      } catch (e) {
        console.error('Unexpected error in rebuild task:', e)
        processedCount++
        return null
      }
    })
  )

  const refreshed: IndexedFileRecord[] = []
  const pendingDocs: { pageContent: string; metadata?: Record<string, unknown> }[] = []

  for (const res of results) {
    if (!res) continue
    refreshed.push(res.record)
    for (const d of res.docs) {
      pendingDocs.push({ pageContent: d.pageContent, metadata: d.metadata })
    }
  }

  if (pendingDocs.length > 0) {
    const { Document } = await import('@langchain/core/documents')
    const docs = pendingDocs.map(
      (d) => new Document({ pageContent: d.pageContent, metadata: d.metadata })
    )
    // 阶段2：建立索引 (30-100%)
    await addDocumentsToStore(docs, onProgress, 30)
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
