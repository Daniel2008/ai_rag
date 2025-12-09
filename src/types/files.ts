export type FileProcessingStatus = 'processing' | 'ready' | 'error'

/** 来源类型 */
export type SourceType = 'file' | 'url'

export interface IndexedFileRecord {
  path: string
  name: string
  chunkCount?: number
  preview?: string
  updatedAt: number
  /** 来源类型：file 或 url */
  sourceType?: SourceType
  /** URL 来源的原始链接 */
  url?: string
  /** URL 来源的站点名称 */
  siteName?: string
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
