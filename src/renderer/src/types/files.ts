export type FileProcessingStatus = 'processing' | 'ready' | 'error'

export interface IndexedFile {
  path: string
  name: string
  status: FileProcessingStatus
  chunkCount?: number
  preview?: string
  error?: string
  updatedAt: number
}
