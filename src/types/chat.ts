/**
 * 聊天相关共享类型定义
 * 被主进程、预加载脚本和渲染进程共同使用
 */

/** 聊天来源信息 */
export interface ChatSource {
  /** 引用内容片段 */
  content: string
  /** 文件名 */
  fileName: string
  /** 页码 */
  pageNumber?: number
  /** 完整文件路径 */
  filePath?: string
  /** 文件类型 */
  fileType?: 'pdf' | 'word' | 'text' | 'markdown' | 'excel' | 'ppt' | 'url' | 'unknown'
  /** 相关度分数 (0-1) */
  score?: number
  /** 内容在文档中的位置（字符偏移） */
  position?: number
  /** 来源类型 */
  sourceType?: 'file' | 'url'
  /** URL 来源的站点名称 */
  siteName?: string
  /** URL 来源的原始链接 */
  url?: string
  /** 抓取/导入时间 */
  fetchedAt?: string
}

/** 问题检索范围 */
export type QuestionScope = 'all' | 'active' | 'collection'

/** 模型提供商类型 */
export type ModelProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek' | 'zhipu' | 'moonshot'

/** 提供商配置 */
export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  chatModel: string
  embeddingModel?: string
}

/** 嵌入模型提供商类型 */
export type EmbeddingProvider = 'local' | 'ollama'

/** 嵌入模型进度信息 */
export interface EmbeddingProgress {
  status: 'downloading' | 'loading' | 'ready' | 'completed' | 'processing' | 'error'
  progress?: number
  file?: string
  message?: string
  taskType?: string
  // 以下字段为扩展字段，用于更好的进度显示
  stage?: string
  percent?: number
}

/** RAG 检索参数设置 */
export interface RagSettings {
  searchLimit: number
  maxSearchLimit: number
  minRelevance: number
}

/** 应用设置 */
export interface AppSettings {
  provider: ModelProvider
  ollama: ProviderConfig
  openai: ProviderConfig
  anthropic: ProviderConfig
  deepseek: ProviderConfig
  zhipu: ProviderConfig
  moonshot: ProviderConfig
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  ollamaUrl: string
  rag: RagSettings
}

/** 文件处理结果 */
export interface ProcessFileResult {
  success: boolean
  count?: number
  preview?: string
  error?: string
}

/** 聊天结果（RAG 返回） */
export interface ChatResult {
  stream: AsyncGenerator<string>
  sources: ChatSource[]
}

/** 文档类型 */
export type DocumentType = 'word' | 'ppt'

/** 文档主题风格 */
export type DocumentTheme = 'professional' | 'modern' | 'simple' | 'creative'

/** 文档生成请求 */
export interface DocumentGenerateRequest {
  type: DocumentType
  title: string
  description?: string
  sources?: string[]
  theme?: DocumentTheme
  targetSections?: number
}

/** 文档生成进度 */
export interface DocumentProgress {
  stage: 'outline' | 'content' | 'generating' | 'complete' | 'error'
  percent: number
  message: string
  error?: string
}

/** 聊天消息 */
export interface ChatMessage {
  key: string
  role: 'user' | 'ai' | 'system'
  content: string
  sources?: ChatSource[]
  typing?: boolean
  timestamp?: number
  status?: 'success' | 'error' | 'pending'
}

/** 文档生成结果 */
export interface DocumentGenerateResult {
  success: boolean
  filePath?: string
  error?: string
}
