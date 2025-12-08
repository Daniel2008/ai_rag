import { useCallback, useState, useMemo, useRef } from 'react'
import { MessageOutlined } from '@ant-design/icons'
import { createElement } from 'react'
import type { ChatMessage, Conversation, ConversationItem } from '../types/chat'
import { INITIAL_MESSAGE } from '../constants/chat'
import {
  saveConversationsToStorage,
  loadConversationsFromStorage,
  saveActiveConversationKey,
  loadActiveConversationKey
} from '../utils/chat'

export interface UseConversationsReturn {
  conversations: Conversation[]
  activeConversationKey: string | undefined
  currentMessages: ChatMessage[]
  conversationItems: ConversationItem[]
  showWelcome: boolean
  handleActiveConversationChange: (key: string | undefined) => void
  createNewConversation: () => void
  updateCurrentMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  handleDeleteConversation: (key: string) => void
  loadConversations: () => { conversations: Conversation[]; activeKey: string | undefined }
}

export function useConversations(): UseConversationsReturn {
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationKey, setActiveConversationKey] = useState<string | undefined>()

  // 使用 ref 存储最新的 activeConversationKey，避免 updateCurrentMessages 频繁重建
  const activeKeyRef = useRef<string | undefined>(activeConversationKey)
  activeKeyRef.current = activeConversationKey

  // 当前对话的消息
  const currentMessages = useMemo(() => {
    const conv = conversations.find((c) => c.key === activeConversationKey)
    return conv?.messages ?? [INITIAL_MESSAGE]
  }, [conversations, activeConversationKey])

  // 转换对话列表为 Conversations 组件需要的格式
  const conversationItems = useMemo<ConversationItem[]>(
    () =>
      conversations.map((conv) => ({
        key: conv.key,
        label: conv.label,
        icon: createElement(MessageOutlined),
        timestamp: conv.timestamp
      })),
    [conversations]
  )

  // 是否显示欢迎页面
  const showWelcome =
    currentMessages.length === 1 &&
    currentMessages[0].role === 'system' &&
    !currentMessages[0].content

  // 包装 setActiveConversationKey 以自动保存
  const handleActiveConversationChange = useCallback((key: string | undefined) => {
    activeKeyRef.current = key
    setActiveConversationKey(key)
    saveActiveConversationKey(key)
  }, [])

  // 创建新对话
  const createNewConversation = useCallback(() => {
    const newKey = `conv-${Date.now()}`
    const newConv: Conversation = {
      key: newKey,
      label: '新对话',
      timestamp: Date.now(),
      messages: [INITIAL_MESSAGE],
      icon: createElement(MessageOutlined)
    }
    setConversations((prev) => {
      const updated = [newConv, ...prev]
      saveConversationsToStorage(updated)
      return updated
    })
    // 同时更新 ref 和 state，确保 updateCurrentMessages 能立即使用新的 key
    activeKeyRef.current = newKey
    setActiveConversationKey(newKey)
    saveActiveConversationKey(newKey)
  }, [])

  // 更新当前对话的消息（使用 ref 避免依赖 activeConversationKey，防止监听器重建）
  const updateCurrentMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      const targetKey = activeKeyRef.current
      if (!targetKey) return

      setConversations((prev) => {
        const updated = prev.map((conv) => {
          if (conv.key === targetKey) {
            const newMessages = updater(conv.messages)
            // 更新对话标题（使用第一条用户消息）
            const firstUserMsg = newMessages.find((m) => m.role === 'user')
            const label = firstUserMsg
              ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '')
              : '新对话'
            return { ...conv, messages: newMessages, label, timestamp: Date.now() }
          }
          return conv
        })
        saveConversationsToStorage(updated)
        return updated
      })
    },
    [] // 移除 activeConversationKey 依赖，使用 ref 替代
  )

  // 删除对话
  const handleDeleteConversation = useCallback((key: string) => {
    setConversations((prev) => {
      const updated = prev.filter((c) => c.key !== key)
      saveConversationsToStorage(updated)

      // 如果删除的是当前激活的对话
      if (activeKeyRef.current === key) {
        if (updated.length > 0) {
          const newActiveKey = updated[0].key
          activeKeyRef.current = newActiveKey
          setActiveConversationKey(newActiveKey)
          saveActiveConversationKey(newActiveKey)
        } else {
          // 没有剩余对话，创建新的
          const newKey = `conv-${Date.now()}`
          const newConv: Conversation = {
            key: newKey,
            label: '新对话',
            timestamp: Date.now(),
            messages: [INITIAL_MESSAGE],
            icon: createElement(MessageOutlined)
          }
          activeKeyRef.current = newKey
          setActiveConversationKey(newKey)
          saveActiveConversationKey(newKey)
          return [newConv]
        }
      }
      return updated
    })
  }, [])

  // 加载对话（用于初始化）
  const loadConversations = useCallback(() => {
    const loadedConversations = loadConversationsFromStorage()
    const loadedActiveKey = loadActiveConversationKey()

    if (loadedConversations.length > 0) {
      setConversations(loadedConversations)
      const validKey =
        loadedActiveKey && loadedConversations.some((c) => c.key === loadedActiveKey)
          ? loadedActiveKey
          : loadedConversations[0]?.key
      activeKeyRef.current = validKey
      setActiveConversationKey(validKey)
      saveActiveConversationKey(validKey)
      return { conversations: loadedConversations, activeKey: validKey }
    }

    return { conversations: [], activeKey: undefined }
  }, [])

  return {
    conversations,
    activeConversationKey,
    currentMessages,
    conversationItems,
    showWelcome,
    handleActiveConversationChange,
    createNewConversation,
    updateCurrentMessages,
    handleDeleteConversation,
    loadConversations
  }
}
