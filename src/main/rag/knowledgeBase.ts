import ElectronStore from 'electron-store'
import fs from 'fs/promises'
import path from 'path'
import { randomUUID } from 'crypto'
import { loadAndSplitFileInWorker } from './workerManager'
import {
  addDocumentsToStore,
  resetVectorStore,
  removeSourceFromStore,
  ensureEmbeddingsInitialized
} from './store/index'
import { normalizePath } from './pathUtils'
import type { Document } from '@langchain/core/documents'
import type {
  DocumentCollection,
  IndexedFileRecord,
  KnowledgeBaseSnapshot,
  BatchImportResult,
  FolderScanResult,
  DocumentVersion
} from '../../types/files'
import { ProgressMessage, ProgressStatus, TaskType } from './progressTypes'
import { logInfo, logWarn, logDebug } from '../utils/logger'
import { createTag, getTagByName } from './tagManager'

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
  const records = getIndexedFileRecords()
  const validSet = new Set(records.map((r) => (r.normalizedPath ?? normalizePath(r.path))))
  return [...new Set(files.filter((path) => validSet.has(normalizePath(path))))]
}

function pruneCollectionsForMissingFiles(): void {
  const records = getIndexedFileRecords()
  const validSet = new Set(records.map((r) => (r.normalizedPath ?? normalizePath(r.path))))
  const collections = getDocumentCollections().map((collection) => ({
    ...collection,
    files: collection.files.filter((path) => validSet.has(normalizePath(path)))
  }))
  saveDocumentCollections(collections)
}

function removeFileFromCollections(path: string): void {
  const nPath = normalizePath(path)
  const collections = getDocumentCollections().map((collection) => ({
    ...collection,
    files: collection.files.filter((filePath) => normalizePath(filePath) !== nPath)
  }))
  saveDocumentCollections(collections)
}

export function getKnowledgeBaseSnapshot(): KnowledgeBaseSnapshot {
  pruneCollectionsForMissingFiles()
  return getSnapshot()
}

export function upsertIndexedFileRecord(record: IndexedFileRecord): void {
  const records = getIndexedFileRecords()
  const nPath = normalizePath(record.path)
  // ensure normalizedPath stored
  const toStore = { ...record, normalizedPath: nPath }
  const index = records.findIndex((item) => (item.normalizedPath ?? normalizePath(item.path)) === nPath)
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
  const filtered = records.filter((item) => (item.normalizedPath ?? normalizePath(item.path)) !== nPath)
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
  const nPath = normalizePath(path)
  const target = records.find((record) => (record.normalizedPath ?? normalizePath(record.path)) === nPath)
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

export async function deleteDocumentCollection(id: string): Promise<KnowledgeBaseSnapshot> {
  const collections = getDocumentCollections()
  const collectionToDelete = collections.find((c) => c.id === id)
  
  if (collectionToDelete && collectionToDelete.files && collectionToDelete.files.length > 0) {
    const filesToDelete = collectionToDelete.files
    logInfo(`Removing ${filesToDelete.length} files from vector store and knowledge base for collection deletion`, 'KnowledgeBase', { 
      collectionId: id,
      files: filesToDelete.slice(0, 5) // 只记录前5个
    })
    
    // 1. 删除向量索引
    const { removeSourcesFromStore } = await import('./store/index')
    try {
      await removeSourcesFromStore(filesToDelete)
    } catch (error) {
      logWarn('Failed to remove collection files from vector store', 'KnowledgeBase', { collectionId: id }, error as Error)
    }
    
    // 2. 删除知识库文件记录
    const records = getIndexedFileRecords()
    const filePathSet = new Set(filesToDelete.map(f => normalizePath(f)))
    const remainingRecords = records.filter(record => {
      const normalizedRecordPath = record.normalizedPath ?? normalizePath(record.path)
      return !filePathSet.has(normalizedRecordPath)
    })
    
    if (remainingRecords.length < records.length) {
      saveIndexedFileRecords(remainingRecords)
      logInfo(`Removed ${records.length - remainingRecords.length} file records from knowledge base`, 'KnowledgeBase', { collectionId: id })
    }
  }
  
  // 3. 删除集合本身
  const remainingCollections = collections.filter((collection) => collection.id !== id)
  saveDocumentCollections(remainingCollections)
  
  // 4. 清理其他集合中对已删除文件的引用
  pruneCollectionsForMissingFiles()
  
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
    // 重建时不使用追加模式，因为已经 resetVectorStore 清空了
    await addDocumentsToStore(docs, onProgress, 30, false)
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

// ==================== 批量导入功能 ====================

/**
 * 扫描文件夹，获取所有支持的文档文件
 */
export async function scanFolder(folderPath: string): Promise<FolderScanResult> {
  const supportedExtensions = new Set([
    '.pdf', '.doc', '.docx', '.txt', '.md', '.markdown',
    '.ppt', '.pptx', '.xls', '.xlsx', '.csv'
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

/**
 * 批量导入文件
 */
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
      // 检查文件是否存在和可读
      try {
        await fs.access(filePath)
      } catch {
        result.failedFiles++
        result.errors.push(`文件不存在或无法访问: ${filePath}`)
        continue
      }

      // 检查是否已存在
      const existingRecords = getIndexedFileRecords()
      const normalizedPath = normalizePath(filePath)
      const exists = existingRecords.some(r => 
        (r.normalizedPath ?? normalizePath(r.path)) === normalizedPath
      )

      if (exists) {
        result.warnings.push(`文件已存在，跳过: ${path.basename(filePath)}`)
        continue
      }

      // 处理文件
      const docs = await loadAndSplitFileInWorker(filePath)
      
      if (docs.length === 0) {
        result.warnings.push(`文件内容为空或无法解析: ${path.basename(filePath)}`)
        continue
      }

      // 获取文件信息
      const stats = await fs.stat(filePath)
      
      // 创建文件记录
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

      // 自动标签处理
      if (options.autoTag) {
        const tags = generateAutoTags(filePath, options.tagPattern)
        if (tags.length > 0) {
          const tagIds: string[] = []
          for (const tagName of tags) {
            const tag = getTagByName(tagName) || createTag(tagName)
            tagIds.push(tag.id)
          }
          record.tags = tagIds
        }
      }

      // 添加到向量存储
      await addDocumentsToStore(docs)

      // 保存记录
      upsertIndexedFileRecord(record)
      processedFiles.push(record)

      result.addedFiles++
      
      // 进度回调
      if (options.onProgress) {
        options.onProgress(i + 1, filePaths.length, path.basename(filePath))
      }

      logDebug('批量导入成功', 'KnowledgeBase', { file: filePath })

    } catch (error) {
      result.failedFiles++
      const errorMsg = `导入失败: ${path.basename(filePath)} - ${(error as Error).message}`
      result.errors.push(errorMsg)
      logWarn('批量导入文件失败', 'KnowledgeBase', { file: filePath }, error as Error)
    }
  }

  // 如果指定了目标集合，添加到集合中
  if (options.targetCollectionId && processedFiles.length > 0) {
    try {
      const collections = getDocumentCollections()
      const collection = collections.find(c => c.id === options.targetCollectionId)
      if (collection) {
        const newPaths = processedFiles.map(f => f.path)
        collection.files = [...new Set([...collection.files, ...newPaths])]
        collection.updatedAt = Date.now()
        
        // 更新集合统计
        if (!collection.stats) {
          collection.stats = { fileCount: 0, totalSize: 0 }
        }
        collection.stats.fileCount = collection.files.length
        const totalSize = collection.stats.totalSize || 0
        collection.stats.totalSize = totalSize + processedFiles.reduce((sum, f) => sum + (f.size || 0), 0)
        collection.stats.lastUpdated = Date.now()
        
        saveDocumentCollections(collections)
        logInfo('已将导入文件添加到集合', 'KnowledgeBase', {
          collectionId: options.targetCollectionId,
          addedFiles: processedFiles.length
        })
      }
    } catch (error) {
      result.warnings.push(`添加到集合失败: ${(error as Error).message}`)
    }
  }

  if (result.addedFiles === 0) {
    result.success = false
  }

  logInfo('批量导入完成', 'KnowledgeBase', {
    total: filePaths.length,
    success: result.addedFiles,
    failed: result.failedFiles
  })

  return result
}

/**
 * 从文件夹批量导入
 */
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
  logInfo('开始从文件夹导入', 'KnowledgeBase', { folder: folderPath })

  const scanResult = await scanFolder(folderPath)

  if (scanResult.files.length === 0) {
    return {
      success: false,
      addedFiles: 0,
      failedFiles: 0,
      errors: ['文件夹中没有支持的文档文件'],
      warnings: []
    }
  }

  // 如果不递归，只导入顶层文件
  const filesToImport = options.recursive 
    ? scanResult.files 
    : scanResult.files.filter(f => path.dirname(f) === folderPath)

  return batchImportFiles(filesToImport, {
    ...options,
    onProgress: options.onProgress
  })
}

/**
 * 生成自动标签
 */
function generateAutoTags(filePath: string, pattern?: string): string[] {
  const tags: string[] = []
  const dirName = path.dirname(filePath)
  const fileName = path.basename(filePath)
  const ext = path.extname(filePath).toLowerCase()

  // 基于文件夹结构生成标签
  const pathParts = dirName.split(path.sep)
  if (pathParts.length > 0) {
    const lastFolder = pathParts[pathParts.length - 1]
    if (lastFolder && lastFolder !== '.' && lastFolder !== '..') {
      tags.push(lastFolder)
    }
  }

  // 基于文件类型生成标签
  const typeMap: Record<string, string> = {
    '.pdf': 'PDF',
    '.doc': 'Word',
    '.docx': 'Word',
    '.txt': '文本',
    '.md': 'Markdown',
    '.ppt': 'PPT',
    '.pptx': 'PPT',
    '.xls': 'Excel',
    '.xlsx': 'Excel'
  }
  if (ext && typeMap[ext]) {
    tags.push(typeMap[ext])
  }

  // 如果有自定义模式，应用模式匹配
  if (pattern) {
    try {
      const regex = new RegExp(pattern, 'g')
      const matches = fileName.match(regex)
      if (matches) {
        tags.push(...matches)
      }
    } catch (error) {
      logWarn('无效的标签模式', 'KnowledgeBase', { pattern }, error as Error)
    }
  }

  return [...new Set(tags)] // 去重
}

/**
 * 版本控制功能
 */

/**
 * 为文件创建新版本
 */
export async function createFileVersion(
  filePath: string,
  newFilePath: string
): Promise<IndexedFileRecord> {
  const records = getIndexedFileRecords()
  const normalizedPath = normalizePath(filePath)
  const record = records.find(r => (r.normalizedPath ?? normalizePath(r.path)) === normalizedPath)

  if (!record) {
    throw new Error('文件记录不存在')
  }

  // 检查新文件是否存在
  try {
    await fs.access(newFilePath)
  } catch {
    throw new Error('新文件不存在')
  }

  // 处理新文件
  const docs = await loadAndSplitFileInWorker(newFilePath)
  
  if (docs.length === 0) {
    throw new Error('新文件内容为空或无法解析')
  }

  // 获取新文件信息
  const stats = await fs.stat(newFilePath)

  // 更新版本历史
  if (!record.versions) {
    record.versions = []
  }

  const newVersion: DocumentVersion = {
    version: (record.currentVersion || 1) + 1,
    filePath: newFilePath,
    createdAt: Date.now(),
    size: stats.size,
    chunkCount: docs.length
  }

  record.versions.push(newVersion)
  record.currentVersion = newVersion.version

  // 更新当前文件路径和元数据
  record.path = newFilePath
  record.name = path.basename(newFilePath)
  record.updatedAt = Date.now()
  record.size = stats.size
  record.chunkCount = docs.length
  record.preview = docs[0]?.pageContent.slice(0, 160) || ''

  // 重新建立向量索引（先移除旧的，再添加新的）
  try {
    await removeSourceFromStore(filePath)
    await addDocumentsToStore(docs)
  } catch (error) {
    logWarn('版本更新时向量索引处理失败', 'KnowledgeBase', { filePath }, error as Error)
  }

  // 保存记录
  upsertIndexedFileRecord(record)

  logInfo('文档版本创建成功', 'KnowledgeBase', {
    file: filePath,
    newVersion: newVersion.version,
    newFile: newFilePath
  })

  return record
}

/**
 * 获取文件版本历史
 */
export function getFileVersions(filePath: string): DocumentVersion[] {
  const records = getIndexedFileRecords()
  const normalizedPath = normalizePath(filePath)
  const record = records.find(r => (r.normalizedPath ?? normalizePath(r.path)) === normalizedPath)

  return record?.versions || []
}

/**
 * 回滚到指定版本
 */
export async function rollbackToVersion(
  filePath: string,
  versionNumber: number
): Promise<IndexedFileRecord> {
  const records = getIndexedFileRecords()
  const normalizedPath = normalizePath(filePath)
  const record = records.find(r => (r.normalizedPath ?? normalizePath(r.path)) === normalizedPath)

  if (!record) {
    throw new Error('文件记录不存在')
  }

  if (!record.versions || record.versions.length === 0) {
    throw new Error('没有版本历史')
  }

  const targetVersion = record.versions.find(v => v.version === versionNumber)
  if (!targetVersion) {
    throw new Error(`版本 ${versionNumber} 不存在`)
  }

  // 加载旧版本文件
  const docs = await loadAndSplitFileInWorker(targetVersion.filePath)

  // 更新当前状态
  record.path = targetVersion.filePath
  record.name = path.basename(targetVersion.filePath)
  record.currentVersion = versionNumber
  record.updatedAt = Date.now()
  record.chunkCount = docs.length
  record.preview = docs[0]?.pageContent.slice(0, 160) || ''

  // 重新建立向量索引
  try {
    await removeSourceFromStore(filePath)
    await addDocumentsToStore(docs)
  } catch (error) {
    logWarn('回滚版本时向量索引处理失败', 'KnowledgeBase', { filePath, version: versionNumber }, error as Error)
  }

  upsertIndexedFileRecord(record)

  logInfo('版本回滚成功', 'KnowledgeBase', {
    file: filePath,
    version: versionNumber
  })

  return record
}

/**
 * 备份知识库数据
 */
export async function backupKnowledgeBase(backupPath: string): Promise<{
  success: boolean
  backupFile?: string
  error?: string
}> {
  try {
    const backupData = {
      files: getIndexedFileRecords(),
      collections: getDocumentCollections(),
      tags: require('./tagManager').getAllTags(),
      timestamp: Date.now(),
      version: '1.0'
    }

    const backupFileName = `knowledge-base-backup-${Date.now()}.json`
    const fullPath = path.join(backupPath, backupFileName)

    await fs.writeFile(fullPath, JSON.stringify(backupData, null, 2), 'utf-8')

    logInfo('知识库备份成功', 'KnowledgeBase', { backupFile: fullPath })

    return {
      success: true,
      backupFile: fullPath
    }
  } catch (error) {
    const errorMsg = `备份失败: ${(error as Error).message}`
    logWarn('知识库备份失败', 'KnowledgeBase', {}, error as Error)
    return {
      success: false,
      error: errorMsg
    }
  }
}

/**
 * 恢复知识库数据
 */
export async function restoreKnowledgeBase(backupFile: string): Promise<{
  success: boolean
  restoredFiles: number
  restoredCollections: number
  error?: string
}> {
  try {
    const backupContent = await fs.readFile(backupFile, 'utf-8')
    const backupData = JSON.parse(backupContent)

    // 验证备份文件格式
    if (!backupData.files || !backupData.collections) {
      throw new Error('无效的备份文件格式')
    }

    // 恢复文件记录
    const existingFiles = getIndexedFileRecords()
    const newFiles = backupData.files.filter((f: IndexedFileRecord) => 
      !existingFiles.some(ef => (ef.normalizedPath ?? normalizePath(ef.path)) === normalizePath(f.path))
    )
    
    const mergedFiles = [...existingFiles, ...newFiles]
    saveIndexedFileRecords(mergedFiles)

    // 恢复集合
    const existingCollections = getDocumentCollections()
    const newCollections = backupData.collections.filter((c: DocumentCollection) => 
      !existingCollections.some(ec => ec.id === c.id)
    )
    
    const mergedCollections = [...existingCollections, ...newCollections]
    saveDocumentCollections(mergedCollections)

    // 恢复标签（如果存在）
    if (backupData.tags) {
      const { getAllTags } = require('./tagManager')
      const existingTags = getAllTags()
      const newTags = backupData.tags.filter((t: any) => 
        !existingTags.some(et => et.id === t.id)
      )
      
      // 标签恢复需要通过 tagManager 的内部 store，这里简化处理
      logInfo('标签数据已包含在备份中', 'KnowledgeBase', { tagCount: backupData.tags.length })
    }

    logInfo('知识库恢复成功', 'KnowledgeBase', {
      restoredFiles: newFiles.length,
      restoredCollections: newCollections.length
    })

    return {
      success: true,
      restoredFiles: newFiles.length,
      restoredCollections: newCollections.length
    }
  } catch (error) {
    const errorMsg = `恢复失败: ${(error as Error).message}`
    logWarn('知识库恢复失败', 'KnowledgeBase', {}, error as Error)
    return {
      success: false,
      restoredFiles: 0,
      restoredCollections: 0,
      error: errorMsg
    }
  }
}
