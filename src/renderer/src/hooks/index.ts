// ===== 核心 Hooks =====
export { useConversations } from './useConversations'
export type { UseConversationsReturn } from './useConversations'

export { useKnowledgeBase } from './useKnowledgeBase'
export type { UseKnowledgeBaseOptions, UseKnowledgeBaseReturn } from './useKnowledgeBase'

// ===== @ant-design/x-sdk 集成 Hooks =====
// 主要使用的聊天 Hook，基于 useXChat 管理消息
export { useChatWithXChat } from './useChatWithXChat'
export type { UseChatWithXChatOptions, UseChatWithXChatReturn } from './useChatWithXChat'
