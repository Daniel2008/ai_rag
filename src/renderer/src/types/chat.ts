import type { ReactElement } from 'react'

/** 聊天来源信息 */
export interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
}

/** 问题检索范围 */
export type QuestionScope = 'all' | 'active' | 'collection'

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
