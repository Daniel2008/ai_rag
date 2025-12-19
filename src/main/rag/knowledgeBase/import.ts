import fs from 'fs/promises'
import path from 'path'
import { loadAndSplitFileInWorker } from '../workerManager'
import { addDocumentsToStore } from '../store/index'
import { normalizePath } from '../pathUtils'
import { IndexedFileRecord, BatchImportResult, FolderScanResult } from '../../../types/files'
import { logInfo, logWarn, logDebug } from '../../utils/logger'
import { createTag, getTagByName } from '../tagManager'
import { getIndexedFileRecords, getDocumentCollections, saveDocumentCollections } from './store'
import { upsertIndexedFileRecord } from './core'

export async function scanFolder(folderPath: string): Promise<FolderScanResult> {
  const supportedExtensions = new Set([
    '.pdf',
    '.doc',
    '.docx',
    '.txt',
    '.md',
    '.markdown',
    '.ppt',
    '.pptx',
    '.xls',
    '.xlsx',
    '.csv'
  ])

  const result: FolderScanResult = {
    files: [],
    folders: [],
    totalSize: 0,
    fileCount: 0
  }

  async function scanDir(currentPath: string): Promise<void> {
    const items = await fs.readdir(currentPath, { withFileTypes: true })
    for (const item of items) {
      const fullPath = path.join(currentPath, item.name)
      if (item.isDirectory()) {
        result.folders.push(fullPath)
        await scanDir(fullPath)
      } else if (item.isFile()) {
        const ext = path.extname(item.name).toLowerCase()
        if (supportedExtensions.has(ext)) {
          result.files.push(fullPath)
          const stats = await fs.stat(fullPath)
          result.totalSize += stats.size
          result.fileCount++
        }
      }
    }
  }

  try {
    await scanDir(folderPath)
    logInfo('文件夹扫描完成', 'KnowledgeBase', {
      folder: folderPath,
      fileCount: result.fileCount,
      totalSize: result.totalSize
    })
  } catch (error) {
    logWarn('文件夹扫描失败', 'KnowledgeBase', { folder: folderPath }, error as Error)
    throw error
  }
  return result
}

export async function batchImportFiles(
  filePaths: string[],
  options: {
    targetCollectionId?: string
    autoTag?: boolean
    tagPattern?: string
    onProgress?: (processed: number, total: number, currentFile: string) => void
  } = {}
): Promise<BatchImportResult> {
  const result: BatchImportResult = {
    success: true,
    addedFiles: 0,
    failedFiles: 0,
    errors: [],
    warnings: []
  }

  const processedFiles: IndexedFileRecord[] = []

  for (let i = 0; i < filePaths.length; i++) {
    const filePath = filePaths[i]
    try {
      await fs.access(filePath)
      const normalizedPath = normalizePath(filePath)
      const existingRecords = getIndexedFileRecords()
      const exists = existingRecords.some(
        (r) => (r.normalizedPath ?? normalizePath(r.path)) === normalizedPath
      )

      if (exists) {
        result.warnings.push(`文件已存在，跳过: ${path.basename(filePath)}`)
        continue
      }

      const docs = await loadAndSplitFileInWorker(filePath)
      if (docs.length === 0) {
        result.warnings.push(`文件内容为空或无法解析: ${path.basename(filePath)}`)
        continue
      }

      const stats = await fs.stat(filePath)
      const record: IndexedFileRecord = {
        path: filePath,
        name: path.basename(filePath),
        chunkCount: docs.length,
        preview: docs[0]?.pageContent.slice(0, 160) || '',
        updatedAt: Date.now(),
        sourceType: 'file',
        size: stats.size,
        createdAt: stats.birthtime.getTime(),
        format: path.extname(filePath).toLowerCase().slice(1)
      }

      if (options.autoTag) {
        const tags = generateAutoTags(filePath, options.tagPattern)
        if (tags.length > 0) {
          const tagIds: string[] = []
          for (const tagName of tags) {
            const tag = getTagByName(tagName) || createTag(tagName)
            if (tag.id) {
              tagIds.push(tag.id)
            }
          }
          record.tags = tagIds
        }
      }

      await addDocumentsToStore(docs)
      upsertIndexedFileRecord(record)
      processedFiles.push(record)
      result.addedFiles++

      if (options.onProgress) {
        options.onProgress(i + 1, filePaths.length, path.basename(filePath))
      }
      logDebug('批量导入成功', 'KnowledgeBase', { file: filePath })
    } catch (error) {
      result.failedFiles++
      result.errors.push(`导入失败: ${path.basename(filePath)} - ${(error as Error).message}`)
      logWarn('批量导入文件失败', 'KnowledgeBase', { file: filePath }, error as Error)
    }
  }

  if (options.targetCollectionId && processedFiles.length > 0) {
    try {
      const collections = getDocumentCollections()
      const collection = collections.find((c) => c.id === options.targetCollectionId)
      if (collection) {
        collection.files = [...new Set([...collection.files, ...processedFiles.map((f) => f.path)])]
        collection.updatedAt = Date.now()
        if (!collection.stats) collection.stats = { fileCount: 0, totalSize: 0 }
        collection.stats.fileCount = collection.files.length
        collection.stats.totalSize =
          (collection.stats.totalSize || 0) +
          processedFiles.reduce((sum, f) => sum + (f.size || 0), 0)
        collection.stats.lastUpdated = Date.now()
        saveDocumentCollections(collections)
      }
    } catch (error) {
      result.warnings.push(`添加到集合失败: ${(error as Error).message}`)
    }
  }

  if (result.addedFiles === 0) result.success = false
  return result
}

function generateAutoTags(filePath: string, _pattern?: string): string[] {
  const tags: string[] = []
  const dirName = path.basename(path.dirname(filePath))

  if (dirName && dirName !== '.' && dirName !== '..') {
    tags.push(dirName)
  }

  const ext = path.extname(filePath).toLowerCase().slice(1)
  if (ext) tags.push(ext.toUpperCase())

  return [...new Set(tags)]
}

export async function importFromFolder(
  folderPath: string,
  options: {
    targetCollectionId?: string
    autoTag?: boolean
    tagPattern?: string
    recursive?: boolean
    onProgress?: (processed: number, total: number, currentFile: string) => void
  } = {}
): Promise<BatchImportResult> {
  const scanResult = await scanFolder(folderPath)
  return batchImportFiles(scanResult.files, options)
}
