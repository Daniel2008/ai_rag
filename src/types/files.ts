export type FileProcessingStatus = 'processing' | 'ready' | 'error'

export interface IndexedFileRecord {
  path: string
  name: string
  chunkCount?: number
  preview?: string
  updatedAt: number
}

export interface IndexedFile extends IndexedFileRecord {
  status: FileProcessingStatus
  error?: string
}

export interface DocumentCollection {
  id: string
  name: string
  description?: string
  files: string[]
  createdAt: number
  updatedAt: number
}

export interface KnowledgeBaseSnapshot {
  files: IndexedFileRecord[]
  collections: DocumentCollection[]
}
