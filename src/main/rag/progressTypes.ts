// 标准进度消息接口定义

/**
 * 进度状态枚举
 */
export enum ProgressStatus {
  DOWNLOADING = 'downloading', // 下载中
  PROCESSING = 'processing', // 处理中
  COMPLETED = 'completed', // 已完成
  ERROR = 'error', // 错误
  READY = 'ready' // 准备就绪
}

/**
 * 任务类型枚举
 */
export enum TaskType {
  MODEL_DOWNLOAD = 'model_download', // 模型下载
  RERANKER_DOWNLOAD = 'reranker_download', // 重排序模型下载
  DOCUMENT_PARSE = 'document_parse', // 文档解析
  DOCUMENT_SPLIT = 'document_split', // 文档分割
  EMBEDDING_GENERATION = 'embedding_generation', // 向量生成
  INDEX_REBUILD = 'index_rebuild', // 重建索引
  UNKNOWN = 'unknown', // 未知任务
  KNOWLEDGE_BASE_BUILD = 'knowledge_base_build' // 知识库构建
}

/**
 * 标准进度消息接口
 */
export interface ProgressMessage {
  /** 任务类型 */
  taskType: TaskType
  /** 进度状态 */
  status: ProgressStatus
  /** 当前进度百分比 (0-100) */
  progress?: number
  /** 当前处理的文件名 */
  fileName?: string
  /** 当前处理的步骤名称 */
  step?: string
  /** 进度描述信息 */
  message: string
  /** 预计剩余时间（毫秒） */
  eta?: number
  /** 已处理的数量 */
  processedCount?: number
  /** 总数量 */
  totalCount?: number
  /** 当前索引 */
  currentIndex?: number
}

/**
 * 进度回调函数类型
 */
export type ProgressCallback = (progress: ProgressMessage) => void
