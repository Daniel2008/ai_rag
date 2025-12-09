import type { ReactElement } from 'react'

// 从共享类型导入并重新导出
export type { ChatSource, QuestionScope } from '../../../types/chat'
import type { ChatSource } from '../../../types/chat'

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

/** 对话 */
export interface Conversation {
  key: string
  label: string
  timestamp: number
  messages: ChatMessage[]
  icon?: ReactElement
}

/** 可序列化的对话类型（不包含 ReactElement） */
export interface SerializableConversation {
  key: string
  label: string
  timestamp: number
  messages: ChatMessage[]
}

/** 对话列表项（用于 Conversations 组件） */
export interface ConversationItem {
  key: string
  label: string
  icon: ReactElement
  timestamp: number
}
