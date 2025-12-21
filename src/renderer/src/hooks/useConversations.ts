import { useCallback, useState, useMemo, useRef, useEffect } from 'react'
import { MessageOutlined, StarFilled } from '@ant-design/icons'
import { createElement } from 'react'
import type { ChatMessage, ConversationItem } from '../types/chat'
import { INITIAL_MESSAGE } from '../constants/chat'
import {
  saveActiveConversationKey,
  loadActiveConversationKey,
  loadStarredConversationKeys,
  saveStarredConversationKeys
} from '../utils/chat'

export interface UseConversationsReturn {
  activeConversationKey: string | undefined
  currentMessages: ChatMessage[]
  conversationItems: ConversationItem[]
  starredConversationKeys: string[]
  showWelcome: boolean
  hasMore: boolean
  loading: boolean
  handleActiveConversationChange: (key: string | undefined) => void
  createNewConversation: () => Promise<string>
  renameConversation: (key: string, label: string) => Promise<void>
  toggleStarConversation: (key: string) => void
  updateCurrentMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  handleDeleteConversation: (key: string) => void
  loadConversations: () => Promise<void>
  loadMoreMessages: () => Promise<void>
  refreshConversations: () => Promise<void>
}

export function useConversations(): UseConversationsReturn {
  const [conversationItems, setConversationItems] = useState<ConversationItem[]>([])
  const [activeConversationKey, setActiveConversationKey] = useState<string | undefined>()
  const [currentMessages, setCurrentMessages] = useState<ChatMessage[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [starredConversationKeys, setStarredConversationKeys] = useState<string[]>(() =>
    loadStarredConversationKeys()
  )

  // 使用 ref 存储最新的 activeConversationKey，避免 updateCurrentMessages 频繁重建
  const activeKeyRef = useRef<string | undefined>(activeConversationKey)
  const starredKeysRef = useRef<string[]>(starredConversationKeys)
  const lastConversationsRef = useRef<Array<{ key: string; label: string; timestamp: number }>>([])

  // 更新 activeKeyRef
  useEffect(() => {
    activeKeyRef.current = activeConversationKey
  }, [activeConversationKey])

  useEffect(() => {
    starredKeysRef.current = starredConversationKeys
  }, [starredConversationKeys])

  // 是否显示欢迎页面
  const showWelcome = useMemo(() => {
    if (!activeConversationKey) return true
    if (currentMessages.length === 0) return true
    if (
      currentMessages.length === 1 &&
      currentMessages[0].role === 'system' &&
      !currentMessages[0].content
    )
      return true
    return false
  }, [activeConversationKey, currentMessages])

  const buildConversationItems = useCallback(
    (convs: Array<{ key: string; label: string; timestamp: number }>, starredKeys: string[]) => {
      const starredSet = new Set(starredKeys)
      const starred: typeof convs = []
      const rest: typeof convs = []
      for (const c of convs) {
        if (starredSet.has(c.key)) starred.push(c)
        else rest.push(c)
      }

      const ordered = [...starred, ...rest]
      return ordered.map((c) => ({
        key: c.key,
        label: c.label,
        icon: createElement(starredSet.has(c.key) ? StarFilled : MessageOutlined),
        timestamp: c.timestamp
      }))
    },
    []
  )

  // 加载对话列表
  const refreshConversations = useCallback(async () => {
    try {
      const convs = await window.api.getConversations()
      lastConversationsRef.current = convs
      setConversationItems(buildConversationItems(convs, starredKeysRef.current))
    } catch (error) {
      console.error('Failed to load conversations:', error)
    }
  }, [buildConversationItems])

  // 加载特定对话的消息
  const loadMessages = useCallback(async (key: string, offset = 0) => {
    try {
      setLoading(true)
      const limit = 20
      const messages = await window.api.getMessages(key, limit, offset)

      // 处理消息格式，确保符合 ChatMessage 类型
      const formattedMessages: ChatMessage[] = messages.map((msg) => ({
        ...msg,
        typing: false, // 历史消息不可能是 typing 状态
        status: (msg.status as ChatMessage['status']) ?? undefined
      }))

      if (offset === 0) {
        // 初始加载，加上 system prompt 如果没有的话
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

  // 切换对话
  const handleActiveConversationChange = useCallback(
    async (key: string | undefined) => {
      if (key === activeKeyRef.current) return

      activeKeyRef.current = key
      setActiveConversationKey(key)
      saveActiveConversationKey(key)

      if (key) {
        await loadMessages(key, 0)
      } else {
        setCurrentMessages([INITIAL_MESSAGE])
      }
    },
    [loadMessages]
  )

  // 加载更多消息
  const loadMoreMessages = useCallback(async () => {
    if (!activeKeyRef.current || loading || !hasMore) return
    const currentCount = currentMessages.length
    // 如果包含初始 system message，偏移量可能需要调整，这里简化处理
    await loadMessages(activeKeyRef.current, currentCount)
  }, [loading, hasMore, currentMessages.length, loadMessages])

  // 创建新对话
  const createNewConversation = useCallback(async () => {
    const newKey = `conv-${Date.now()}`
    const label = '新对话'

    // 1. 本地先创建
    await window.api.createConversation(newKey, label)

    // 2. 插入初始消息
    const initialMsg = { ...INITIAL_MESSAGE, key: `${newKey}-system`, timestamp: Date.now() }
    await window.api.saveMessage(newKey, initialMsg)

    // 3. 刷新列表并选中
    await refreshConversations()
    await handleActiveConversationChange(newKey)

    return newKey
  }, [refreshConversations, handleActiveConversationChange])

  // 更新当前对话的消息（乐观更新 + 异步持久化在业务层处理）
  const updateCurrentMessages = useCallback((updater: (prev: ChatMessage[]) => ChatMessage[]) => {
    setCurrentMessages((prev) => {
      const next = updater(prev)
      return next
    })
  }, [])

  const renameConversation = useCallback(
    async (key: string, label: string) => {
      const trimmed = label.trim()
      if (!trimmed) return
      await window.api.updateConversation(key, trimmed)
      await refreshConversations()
    },
    [refreshConversations]
  )

  const toggleStarConversation = useCallback(
    (key: string) => {
      setStarredConversationKeys((prev) => {
        const next = prev.includes(key) ? prev.filter((k) => k !== key) : [key, ...prev]
        saveStarredConversationKeys(next)
        setConversationItems(buildConversationItems(lastConversationsRef.current, next))
        return next
      })
    },
    [buildConversationItems]
  )

  // 删除对话
  const handleDeleteConversation = useCallback(
    async (key: string) => {
      try {
        await window.api.deleteConversation(key)
        setStarredConversationKeys((prev) => {
          if (!prev.includes(key)) return prev
          const next = prev.filter((k) => k !== key)
          saveStarredConversationKeys(next)
          return next
        })
        await refreshConversations()

        if (activeKeyRef.current === key) {
          // 如果删除的是当前对话，切换到第一个或者创建新的
          const convs = await window.api.getConversations()
          if (convs.length > 0) {
            handleActiveConversationChange(convs[0].key)
          } else {
            // 创建新的
            createNewConversation()
          }
        }
      } catch (error) {
        console.error('Failed to delete conversation:', error)
      }
    },
    [refreshConversations, handleActiveConversationChange, createNewConversation]
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
    activeConversationKey,
    currentMessages,
    conversationItems,
    starredConversationKeys,
    showWelcome,
    hasMore,
    loading,
    handleActiveConversationChange,
    createNewConversation,
    renameConversation,
    toggleStarConversation,
    updateCurrentMessages,
    handleDeleteConversation,
    loadConversations,
    loadMoreMessages,
    refreshConversations
  }
}
