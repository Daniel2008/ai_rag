export type FileProcessingStatus = 'processing' | 'ready' | 'error'

/** 来源类型 */
export type SourceType = 'file' | 'url'

/** 文档标签 */
export interface DocumentTag {
  id: string
  name: string
  color?: string
  createdAt: number
}

/** 文档版本信息 */
export interface DocumentVersion {
  version: number
  filePath: string
  createdAt: number
  size?: number
  chunkCount?: number
}

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
  /** 标准化路径（用于内部匹配，保持可选以兼容旧记录） */
  normalizedPath?: string
  /** 文档标签 */
  tags?: string[]
  /** 文档版本历史 */
  versions?: DocumentVersion[]
  /** 当前版本号 */
  currentVersion?: number
  /** 文档大小（字节） */
  size?: number
  /** 文档创建时间 */
  createdAt?: number
  /** 文档元数据（如作者、标题等） */
  metadata?: Record<string, unknown>
  /** 文档格式（如 PDF、Word 等） */
  format?: string
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
  /** 集合标签 */
  tags?: string[]
  /** 集合统计信息 */
  stats?: {
    fileCount: number
    totalSize?: number
    lastUpdated?: number
  }
}

export interface KnowledgeBaseSnapshot {
  files: IndexedFile[]
  collections: DocumentCollection[]
  /** 全局标签列表 */
  availableTags?: DocumentTag[]
}

/** 批量导入结果 */
export interface BatchImportResult {
  success: boolean
  addedFiles: number
  failedFiles: number
  errors: string[]
  warnings: string[]
}

/** 文件夹扫描结果 */
export interface FolderScanResult {
  files: string[]
  folders: string[]
  totalSize: number
  fileCount: number
}
