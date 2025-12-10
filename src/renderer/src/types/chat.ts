import type { ReactElement } from 'react'

// 从共享类型导入并重新导出
export type { ChatSource, QuestionScope, ChatMessage } from '../../../types/chat'
import type { ChatMessage } from '../../../types/chat'

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
