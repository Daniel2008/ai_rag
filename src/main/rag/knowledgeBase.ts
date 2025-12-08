import ElectronStore from 'electron-store'
import fs from 'fs/promises'
import { randomUUID } from 'crypto'
import { loadAndSplitFile } from './loader'
import { addDocumentsToStore, resetVectorStore } from './store'
import type {
  DocumentCollection,
  IndexedFileRecord,
  KnowledgeBaseSnapshot
} from '../../types/files'

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
const store = new (StoreConstructor as new (config: Record<string, unknown>) => ElectronStore<KnowledgeBaseStoreShape>)(storeConfig)

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
    files: getIndexedFileRecords(),
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
  return refreshKnowledgeBase()
}

export async function refreshKnowledgeBase(): Promise<KnowledgeBaseSnapshot> {
  const records = getIndexedFileRecords()
  const refreshed = await rebuildVectorStore(records)
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
  return refreshKnowledgeBase()
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

async function rebuildVectorStore(records: IndexedFileRecord[]): Promise<IndexedFileRecord[]> {
  await resetVectorStore()
  const refreshed: IndexedFileRecord[] = []

  for (const record of records) {
    try {
      await fs.access(record.path)
    } catch (error) {
      console.warn('文件不存在，已从知识库移除:', record.path, error)
      continue
    }

    try {
      const docs = await loadAndSplitFile(record.path)
      await addDocumentsToStore(docs)
      refreshed.push({
        ...record,
        chunkCount: docs.length,
        preview: docs[0]?.pageContent.slice(0, 160) ?? record.preview,
        updatedAt: Date.now()
      })
    } catch (err) {
      console.error('重建知识库时处理文件失败:', record.path, err)
    }
  }

  return refreshed
}
