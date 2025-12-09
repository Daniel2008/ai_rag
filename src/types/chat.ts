/**
 * 聊天相关共享类型定义
 * 被主进程、预加载脚本和渲染进程共同使用
 */

/** 聊天来源信息 */
export interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
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
