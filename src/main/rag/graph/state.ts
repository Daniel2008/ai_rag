import { ChatSource } from '../../../types/chat'

/**
 * LangGraph 聊天状态接口
 */
export interface ChatGraphState {
  runId: string
  conversationKey?: string
  question: string
  sources?: string[]
  tags?: string[]
  memory?: string | null
  context?: string
  isGlobalSearch?: boolean
  answer?: string
  usedSources?: ChatSource[]
  contextMetrics?: Record<string, unknown>
  error?: string
  onToken?: (chunk: string) => void
  // 进阶扩展
  documentIntent?: unknown // 文档生成意图
  searchIntent?: boolean // 联网搜索意图
  analysisIntent?: boolean // 长文分析意图
  kbOverviewIntent?: boolean // 知识库概览意图
  translatedQuestion?: string
  suggestedQuestions?: string[]
  groundingStatus?: 'ok' | 'missing_citations' | 'invalid_citations'
  retryCount?: number
  [key: string]: unknown
}
