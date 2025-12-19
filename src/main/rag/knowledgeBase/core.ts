import { normalizePath } from '../pathUtils'
import { IndexedFileRecord, KnowledgeBaseSnapshot } from '../../../types/files'
import {
  getIndexedFileRecords,
  saveIndexedFileRecords,
  getDocumentCollections,
  saveDocumentCollections
} from './store'
import { removeSourceFromStore } from '../store/index'

export function getSnapshot(): KnowledgeBaseSnapshot {
  const records = getIndexedFileRecords()

  // 从所有文件中汇总标签
  const tagCounts = new Map<string, number>()
  records.forEach((record) => {
    if (record.tags) {
      record.tags.forEach((tag) => {
        tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1)
      })
    }
  })

  const availableTags = Array.from(tagCounts.entries()).map(([name, count]) => ({
    name,
    count,
    color: '#1890ff' // 默认颜色
  }))

  return {
    files: records.map((record) => ({
      ...record,
      status: 'ready' as const
    })),
    collections: getDocumentCollections(),
    availableTags
  }
}

export function sanitizeCollectionFiles(files: string[] = []): string[] {
  const records = getIndexedFileRecords()
  const validSet = new Set(records.map((r) => r.normalizedPath ?? normalizePath(r.path)))
  return [...new Set(files.filter((path) => validSet.has(normalizePath(path))))]
}

export function pruneCollectionsForMissingFiles(): void {
  const records = getIndexedFileRecords()
  const validSet = new Set(records.map((r) => r.normalizedPath ?? normalizePath(r.path)))
  const collections = getDocumentCollections().map((collection) => ({
    ...collection,
    files: collection.files.filter((path) => validSet.has(normalizePath(path)))
  }))
  saveDocumentCollections(collections)
}

export function removeFileFromCollections(path: string): void {
  const nPath = normalizePath(path)
  const collections = getDocumentCollections().map((collection) => ({
    ...collection,
    files: collection.files.filter((filePath) => normalizePath(filePath) !== nPath)
  }))
  saveDocumentCollections(collections)
}

export function upsertIndexedFileRecord(record: IndexedFileRecord): void {
  const records = getIndexedFileRecords()
  const nPath = normalizePath(record.path)
  const toStore = { ...record, normalizedPath: nPath }
  const index = records.findIndex(
    (item) => (item.normalizedPath ?? normalizePath(item.path)) === nPath
  )
  if (index >= 0) {
    records[index] = { ...records[index], ...toStore }
  } else {
    records.push(toStore)
  }
  saveIndexedFileRecords(records)
}

export async function removeIndexedFileRecord(path: string): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const nPath = normalizePath(path)
  const filtered = records.filter(
    (item) => (item.normalizedPath ?? normalizePath(item.path)) !== nPath
  )
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
