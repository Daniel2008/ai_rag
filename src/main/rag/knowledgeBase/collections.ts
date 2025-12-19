import { randomUUID } from 'crypto'
import { DocumentCollection, KnowledgeBaseSnapshot } from '../../../types/files'
import { logInfo, logWarn } from '../../utils/logger'
import {
  getDocumentCollections,
  saveDocumentCollections,
  getIndexedFileRecords,
  saveIndexedFileRecords
} from './store'
import { getSnapshot, sanitizeCollectionFiles, pruneCollectionsForMissingFiles } from './core'
import { normalizePath } from '../pathUtils'

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

export async function deleteDocumentCollection(id: string): Promise<KnowledgeBaseSnapshot> {
  const collections = getDocumentCollections()
  const collectionToDelete = collections.find((c) => c.id === id)

  if (collectionToDelete && collectionToDelete.files && collectionToDelete.files.length > 0) {
    const filesToDelete = collectionToDelete.files
    logInfo(`Removing ${filesToDelete.length} files for collection deletion`, 'KnowledgeBase', {
      collectionId: id
    })

    const { removeSourcesFromStore } = await import('../store/index')
    try {
      await removeSourcesFromStore(filesToDelete)
    } catch (error) {
      logWarn(
        'Failed to remove collection files from vector store',
        'KnowledgeBase',
        { collectionId: id },
        error as Error
      )
    }

    const records = getIndexedFileRecords()
    const filePathSet = new Set(filesToDelete.map((f) => normalizePath(f)))
    const remainingRecords = records.filter((record) => {
      const normalizedRecordPath = record.normalizedPath ?? normalizePath(record.path)
      return !filePathSet.has(normalizedRecordPath)
    })

    if (remainingRecords.length < records.length) {
      saveIndexedFileRecords(remainingRecords)
    }
  }

  const remainingCollections = collections.filter((collection) => collection.id !== id)
  saveDocumentCollections(remainingCollections)
  pruneCollectionsForMissingFiles()
  return getSnapshot()
}
