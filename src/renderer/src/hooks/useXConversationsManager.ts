/**
 * 基于 @ant-design/x-sdk 的会话列表管理 Hook
 * 使用 useXConversations 统一管理多会话
 */

import { useCallback, useMemo, useRef, useEffect, useState } from 'react'
import { useXConversations } from '@ant-design/x-sdk'
import { MessageOutlined } from '@ant-design/icons'
import { createElement } from 'react'
import type { ChatMessage, ConversationItem } from '../types/chat'
import { INITIAL_MESSAGE } from '../constants/chat'
import { saveActiveConversationKey, loadActiveConversationKey } from '../utils/chat'

export interface XConversationData {
  key: string
  label: string
  timestamp: number
}

export interface UseXConversationsManagerReturn {
  /** 当前活跃的会话 key */
  activeConversationKey: string | undefined
  /** 当前会话的消息列表 */
  currentMessages: ChatMessage[]
  /** 会话列表项（用于 UI 显示） */
  conversationItems: ConversationItem[]
  /** 是否显示欢迎页面 */
  showWelcome: boolean
  /** 是否有更多历史消息 */
  hasMore: boolean
  /** 是否正在加载 */
  loading: boolean
  /** 切换会话 */
  handleActiveConversationChange: (key: string | undefined) => void
  /** 创建新会话 */
  createNewConversation: () => Promise<string>
  /** 更新当前消息 */
  updateCurrentMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  /** 删除会话 */
  handleDeleteConversation: (key: string) => void
  /** 加载会话列表 */
  loadConversations: () => Promise<void>
  /** 加载更多消息 */
  loadMoreMessages: () => Promise<void>
  /** 刷新会话列表 */
  refreshConversations: () => Promise<void>
}

export function useXConversationsManager(): UseXConversationsManagerReturn {
  // 使用 useXConversations 管理会话列表
  const {
    conversations: rawConversations,
    activeConversationKey: activeKey,
    setActiveConversationKey: setActiveKey,
    addConversation,
    removeConversation,
    setConversation,
    setConversations
  } = useXConversations({
    defaultActiveConversationKey: undefined,
    defaultConversations: []
  })

  // 类型断言，因为我们知道 conversations 包含 XConversationData 的属性
  const conversations = rawConversations as XConversationData[]

  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)

  // 使用 ref 存储最新的 activeKey，避免频繁重建回调
  // 空字符串视为 undefined
  const activeKeyRef = useRef<string | undefined>(activeKey || undefined)

  // 更新 activeKeyRef
  useEffect(() => {
    activeKeyRef.current = activeKey || undefined
  }, [activeKey])

  // 转换为 UI 需要的 ConversationItem 格式
  const conversationItems = useMemo<ConversationItem[]>(() => {
    return conversations.map((conv) => ({
      key: conv.key,
      label: conv.label,
      icon: createElement(MessageOutlined),
      timestamp: conv.timestamp
    }))
  }, [conversations])

  // 是否显示欢迎页面
  // 空字符串也视为无活跃会话
  const showWelcome = useMemo(() => {
    if (!activeKey || activeKey === '') return true
    if (currentMessages.length === 0) return true
    if (
      currentMessages.length === 1 &&
      currentMessages[0].role === 'system' &&
      !currentMessages[0].content
    )
      return true
    return false
  }, [activeKey, currentMessages])

  // 从数据库加载会话列表
  const refreshConversations = useCallback(async () => {
    try {
      const convs = await window.api.getConversations()
      setConversations(
        convs.map((c) => ({
          key: c.key,
          label: c.label,
          timestamp: c.timestamp
        }))
      )
    } catch (error) {
      console.error('Failed to load conversations:', error)
    }
  }, [setConversations])

  // 加载特定会话的消息
  const loadMessages = useCallback(async (key: string, offset = 0) => {
    try {
      setLoading(true)
      const limit = 20
      const messages = await window.api.getMessages(key, limit, offset)

      // 处理消息格式
      const formattedMessages = messages.map((msg) => ({
        ...msg,
        typing: false
      }))

      if (offset === 0) {
        // 初始加载
        if (formattedMessages.length === 0) {
          setCurrentMessages([INITIAL_MESSAGE])
        } else {
          setCurrentMessages(formattedMessages)
        }
      } else {
        // 加载更多，插在前面
        setCurrentMessages((prev) => [...formattedMessages, ...prev])
      }

      setHasMore(messages.length === limit)
    } catch (error) {
      console.error('Failed to load messages:', error)
    } finally {
      setLoading(false)
    }
  }, [])

  // 切换会话
  const handleActiveConversationChange = useCallback(
    async (key: string | undefined) => {
      if (key === activeKeyRef.current) return

      activeKeyRef.current = key
      // setActiveConversationKey 需要 string 类型，空值时传空字符串
      setActiveKey(key ?? '')
      saveActiveConversationKey(key)

      if (key) {
        await loadMessages(key, 0)
      } else {
        setCurrentMessages([INITIAL_MESSAGE])
      }
    },
    [loadMessages, setActiveKey]
  )

  // 加载更多消息
  const loadMoreMessages = useCallback(async () => {
    if (!activeKeyRef.current || loading || !hasMore) return
    const currentCount = currentMessages.length
    await loadMessages(activeKeyRef.current, currentCount)
  }, [loading, hasMore, currentMessages.length, loadMessages])

  // 创建新会话
  const createNewConversation = useCallback(async () => {
    const newKey = `conv-${Date.now()}`
    const label = '新对话'
    const timestamp = Date.now()

    // 1. 持久化到数据库
    await window.api.createConversation(newKey, label)

    // 2. 插入初始消息
    const initialMsg = { ...INITIAL_MESSAGE, key: `${newKey}-system`, timestamp }
    await window.api.saveMessage(newKey, initialMsg)

    // 3. 添加到 useXConversations 管理的状态
    addConversation({
      key: newKey,
      label,
      timestamp
    })

    // 4. 切换到新会话
    await handleActiveConversationChange(newKey)

    return newKey
  }, [addConversation, handleActiveConversationChange])

  // 更新当前会话的消息
  const updateCurrentMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setCurrentMessages((prev) => {
        const next = updater(prev)

        // 如果有新的用户消息，更新会话标题
        const lastUserMsg = [...next].reverse().find((m) => m.role === 'user')
        if (lastUserMsg && activeKeyRef.current) {
          const currentConv = conversations.find((c) => c.key === activeKeyRef.current)
          if (currentConv && currentConv.label === '新对话') {
            // 使用第一条用户消息作为会话标题
            const newLabel =
              lastUserMsg.content.length > 20
                ? `${lastUserMsg.content.slice(0, 20)}...`
                : lastUserMsg.content

            // 使用 setConversation 更新会话信息
            setConversation(activeKeyRef.current, {
              ...currentConv,
              label: newLabel
            })

            // 注意：如果需要持久化会话标题，需要在 preload 中添加 updateConversation API
            // 目前暂时跳过数据库同步，标题会在下次加载时刷新
          }
        }

        return next
      })
    },
    [conversations, setConversation]
  )

  // 删除会话
  const handleDeleteConversation = useCallback(
    async (key: string) => {
      try {
        await window.api.deleteConversation(key)

        // 从 useXConversations 中移除
        removeConversation(key)

        if (activeKeyRef.current === key) {
          // 如果删除的是当前会话，切换到第一个或创建新的
          const remainingConvs = conversations.filter((c) => c.key !== key)
          if (remainingConvs.length > 0) {
            handleActiveConversationChange(remainingConvs[0].key)
          } else {
            createNewConversation()
          }
        }
      } catch (error) {
        console.error('Failed to delete conversation:', error)
      }
    },
    [conversations, removeConversation, handleActiveConversationChange, createNewConversation]
  )

  // 初始化加载
  const loadConversations = useCallback(async () => {
    await refreshConversations()
    const savedKey = loadActiveConversationKey()
    const convs = await window.api.getConversations()

    if (savedKey && convs.some((c) => c.key === savedKey)) {
      handleActiveConversationChange(savedKey)
    } else if (convs.length > 0) {
      handleActiveConversationChange(convs[0].key)
    } else {
      createNewConversation()
    }
  }, [refreshConversations, handleActiveConversationChange, createNewConversation])

  return {
    // activeKey 是空字符串时视为 undefined，保持与原有接口兼容
    activeConversationKey: activeKey || undefined,
    currentMessages,
    conversationItems,
    showWelcome,
    hasMore,
    loading,
    handleActiveConversationChange,
    createNewConversation,
    updateCurrentMessages,
    handleDeleteConversation,
    loadConversations,
    loadMoreMessages,
    refreshConversations
  }
}

