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

    return () => {
      window.api.removeProcessProgressListener()
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

      setActiveCollectionId((currentActiveCollectionId) => {
        if (snapshot.collections.length === 0) {
          setActiveDocumentState(undefined)
          return undefined
        }

        if (
          currentActiveCollectionId &&
          !snapshot.collections.some((collection) => collection.id === currentActiveCollectionId)
        ) {
          const fallbackCollection = snapshot.collections[0]
          setActiveDocumentState(fallbackCollection?.files[0])
          return fallbackCollection?.id
        }

        if (currentActiveCollectionId) {
          const currentCollection = snapshot.collections.find(
            (collection) => collection.id === currentActiveCollectionId
          )
          if (currentCollection) {
            setActiveDocumentState((currentActiveDocument) => {
              if (currentCollection.files.length === 0) {
                return undefined
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
        const filePath = await window.api.selectFile()
        if (!filePath) return

        if (files.some((file) => file.path === filePath)) {
          messageApi.info('该文件已经导入')
          return
        }

        const nextFile: IndexedFile = {
          path: filePath,
          name: extractFileName(filePath),
          status: 'processing',
          updatedAt: Date.now()
        }

        setFiles((prev) => [...prev, nextFile])
        setActiveDocumentState(filePath)

        const result = await window.api.processFile(filePath)
        if (result.success) {
          setFiles((prev) =>
            prev.map((file) =>
              file.path === filePath
                ? {
                    ...file,
                    status: 'ready',
                    chunkCount: result.count,
                    preview: result.preview,
                    error: undefined,
                    updatedAt: Date.now()
                  }
                : file
            )
          )

          if (targetCollectionId) {
            const targetCollection = collections.find((c) => c.id === targetCollectionId)
            if (targetCollection && !targetCollection.files.includes(filePath)) {
              const snapshot = await window.api.updateCollection({
                id: targetCollectionId,
                files: [...targetCollection.files, filePath]
              })
              syncKnowledgeBase(snapshot)
            }
          }

          messageApi.success('文档索引完成')
        } else {
          setFiles((prev) =>
            prev.map((file) =>
              file.path === filePath
                ? {
                    ...file,
                    status: 'error',
                    error: result.error ?? '未知错误',
                    updatedAt: Date.now()
                  }
                : file
            )
          )
          messageApi.error(result.error ?? '文档处理失败')
        }
      } catch (error) {
        console.error(error)
        messageApi.error('文档处理失败，请查看控制台日志')
      }
    },
    [files, collections, messageApi, syncKnowledgeBase]
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
