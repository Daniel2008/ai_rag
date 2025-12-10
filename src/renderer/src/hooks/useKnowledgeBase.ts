import { useCallback, useEffect, useMemo, useState } from 'react'
import type { MessageInstance } from 'antd/es/message/interface'
import type { DocumentCollection, IndexedFile, KnowledgeBaseSnapshot } from '../types/files'
import type { QuestionScope } from '../types/chat'
import { extractFileName, mergeRecordsWithTransient } from '../utils/chat'

export interface UseKnowledgeBaseOptions {
  messageApi: MessageInstance
}

/** 文档处理进度 */
export interface ProcessProgress {
  stage: string
  percent: number
  error?: string
}

export interface UseKnowledgeBaseReturn {
  files: IndexedFile[]
  collections: DocumentCollection[]
  activeDocument: string | undefined
  activeCollectionId: string | undefined
  questionScope: QuestionScope
  readyDocuments: number
  activeFile: IndexedFile | undefined
  resolvedCollectionId: string | undefined
  /** 当前处理进度（null 表示没有正在处理的任务） */
  processProgress: ProcessProgress | null
  setActiveDocument: (path: string | undefined) => void
  setActiveCollectionId: React.Dispatch<React.SetStateAction<string | undefined>>
  setQuestionScope: React.Dispatch<React.SetStateAction<QuestionScope>>
  syncKnowledgeBase: (snapshot: KnowledgeBaseSnapshot) => void
  handleUpload: (targetCollectionId?: string) => Promise<void>
  handleReindexDocument: (filePath: string) => Promise<void>
  handleRemoveDocument: (filePath: string) => Promise<void>
}

export function useKnowledgeBase({ messageApi }: UseKnowledgeBaseOptions): UseKnowledgeBaseReturn {
  const [files, setFiles] = useState<IndexedFile[]>([])
  const [collections, setCollections] = useState<DocumentCollection[]>([])
  const [activeDocument, setActiveDocumentState] = useState<string | undefined>(undefined)
  const [activeCollectionId, setActiveCollectionId] = useState<string | undefined>(undefined)
  const [questionScope, setQuestionScope] = useState<QuestionScope>('all')
  const [processProgress, setProcessProgress] = useState<ProcessProgress | null>(null)

  // 监听文档处理进度
  useEffect(() => {
    window.api.onProcessProgress((progress) => {
      setProcessProgress(progress)
      // 处理完成后自动清除进度
      if (progress.percent === 100 || progress.error) {
        setTimeout(() => setProcessProgress(null), 2000)
      }
    })

    // 监听嵌入模型进度
    window.api.onEmbeddingProgress((progress) => {
      let stage = progress.message || '正在处理模型...'
      if (progress.status === 'downloading') {
        stage = `下载模型: ${progress.file || ''} ${Math.round(progress.progress || 0)}%`
      } else if (progress.status === 'loading') {
        // 如果有消息则使用消息，否则显示默认提示
        stage = progress.message || '正在加载模型...'
      } else if (progress.status === 'ready') {
        stage = '模型就绪'
      }

      setProcessProgress({
        stage,
        percent: progress.progress || 0,
        error: progress.status === 'error' ? progress.message : undefined
      })

      if (progress.status === 'ready' || progress.status === 'error') {
        setTimeout(() => setProcessProgress(null), 2000)
      }
    })

    return () => {
      window.api.removeProcessProgressListener()
      window.api.removeEmbeddingProgressListener()
    }
  }, [])

  const readyDocuments = useMemo(
    () => files.filter((file) => file.status === 'ready').length,
    [files]
  )

  const activeFile = useMemo(
    () => files.find((file) => file.path === activeDocument),
    [files, activeDocument]
  )

  const resolvedCollectionId = useMemo(() => {
    if (!collections.length) {
      return undefined
    }
    if (activeCollectionId && collections.some((c) => c.id === activeCollectionId)) {
      return activeCollectionId
    }
    return collections[0]?.id
  }, [activeCollectionId, collections])

  const setActiveDocument = useCallback(
    (path?: string) => {
      setActiveDocumentState(path)
      if (!path && questionScope === 'active') {
        setQuestionScope('all')
      }
    },
    [questionScope]
  )

  const syncKnowledgeBase = useCallback(
    (snapshot: KnowledgeBaseSnapshot) => {
      setFiles((prev) => mergeRecordsWithTransient(snapshot.files, prev))
      setCollections(snapshot.collections)

      // 获取所有就绪的文件用于回退选择
      const readyFiles = snapshot.files.filter((f) => f.status === 'ready')

      setActiveCollectionId((currentActiveCollectionId) => {
        if (snapshot.collections.length === 0) {
          // 没有文档集时，保留 activeDocument（如果它在可用文件中）
          // 否则回退到第一个就绪文件
          setActiveDocumentState((currentActiveDocument) => {
            if (currentActiveDocument && readyFiles.some((f) => f.path === currentActiveDocument)) {
              return currentActiveDocument
            }
            return readyFiles[0]?.path
          })
          return undefined
        }

        if (
          currentActiveCollectionId &&
          !snapshot.collections.some((collection) => collection.id === currentActiveCollectionId)
        ) {
          const fallbackCollection = snapshot.collections[0]
          setActiveDocumentState(fallbackCollection?.files[0] || readyFiles[0]?.path)
          return fallbackCollection?.id
        }

        if (currentActiveCollectionId) {
          const currentCollection = snapshot.collections.find(
            (collection) => collection.id === currentActiveCollectionId
          )
          if (currentCollection) {
            setActiveDocumentState((currentActiveDocument) => {
              if (currentCollection.files.length === 0) {
                // 当前文档集为空，回退到所有就绪文件中的第一个
                return readyFiles[0]?.path
              }
              if (
                currentActiveDocument &&
                !currentCollection.files.includes(currentActiveDocument)
              ) {
                return currentCollection.files[0]
              }
              return currentActiveDocument
            })
          }
        }
        return currentActiveCollectionId
      })

      if (snapshot.collections.length === 0 && questionScope === 'collection') {
        setQuestionScope('all')
      }
    },
    [questionScope]
  )

  const handleUpload = useCallback(
    async (targetCollectionId?: string): Promise<void> => {
      try {
        const filePaths = await window.api.selectFiles()
        if (!filePaths || filePaths.length === 0) return

        // 添加占位符
        const newFiles: IndexedFile[] = filePaths.map((path) => ({
          path,
          name: extractFileName(path),
          status: 'processing',
          updatedAt: Date.now()
        }))

        // 更新状态：移除旧的同名文件记录（如果有），添加新的
        setFiles((prev) => {
          const existingPaths = new Set(filePaths)
          const filtered = prev.filter((f) => !existingPaths.has(f.path))
          return [...filtered, ...newFiles]
        })

        if (filePaths.length === 1) {
          setActiveDocumentState(filePaths[0])
        }

        const result = await window.api.processFile(filePaths)
        
        // 批量处理完后，重新拉取整个知识库状态以确保一致性
        const snapshot = await window.api.getKnowledgeBase()
        syncKnowledgeBase(snapshot)

        if (result.success) {
          messageApi.success(`成功处理，共生成 ${result.count} 个片段`)

          if (targetCollectionId) {
            const targetCollection = collections.find((c) => c.id === targetCollectionId)
            if (targetCollection) {
              const uniqueFiles = Array.from(new Set([...targetCollection.files, ...filePaths]))
              if (uniqueFiles.length !== targetCollection.files.length) {
                const updatedSnapshot = await window.api.updateCollection({
                  id: targetCollectionId,
                  files: uniqueFiles
                })
                syncKnowledgeBase(updatedSnapshot)
              }
            }
          }
        } else {
          messageApi.error(result.error ?? '文档处理失败')
        }
      } catch (error) {
        console.error(error)
        messageApi.error('文档处理失败，请查看控制台日志')
        // 发生错误也刷新一下，消除 processing 状态
        const snapshot = await window.api.getKnowledgeBase()
        syncKnowledgeBase(snapshot)
      }
    },
    [collections, messageApi, syncKnowledgeBase]
  )

  const handleReindexDocument = useCallback(
    async (filePath: string) => {
      try {
        messageApi.loading({ content: '正在重新索引...', key: 'reindex' })
        const snapshot = await window.api.reindexIndexedFile(filePath)
        syncKnowledgeBase(snapshot)
        messageApi.success({ content: '重新索引完成', key: 'reindex' })
      } catch (error) {
        console.error('Failed to reindex document:', error)
        messageApi.error({ content: '重新索引失败，请查看日志', key: 'reindex' })
      }
    },
    [messageApi, syncKnowledgeBase]
  )

  const handleRemoveDocument = useCallback(
    async (filePath: string) => {
      try {
        const snapshot = await window.api.removeIndexedFile(filePath)
        syncKnowledgeBase(snapshot)
        if (activeDocument === filePath) {
          setActiveDocument(undefined)
        }
        messageApi.success('文档已移除')
      } catch (error) {
        console.error('Failed to remove document:', error)
        messageApi.error('移除文档失败，请查看日志')
      }
    },
    [activeDocument, messageApi, syncKnowledgeBase, setActiveDocument]
  )

  return {
    files,
    collections,
    activeDocument,
    activeCollectionId,
    questionScope,
    readyDocuments,
    activeFile,
    resolvedCollectionId,
    processProgress,
    setActiveDocument,
    setActiveCollectionId,
    setQuestionScope,
    syncKnowledgeBase,
    handleUpload,
    handleReindexDocument,
    handleRemoveDocument
  }
}
