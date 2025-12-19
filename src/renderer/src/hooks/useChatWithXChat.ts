/**
 * 基于 @ant-design/x-sdk useXChat 的聊天流管理 Hook
 * 完全使用 useXChat 管理消息，按照官方文档的方式使用
 */

import { useCallback, useEffect, useRef, useMemo, useState } from 'react'
import { useXChat } from '@ant-design/x-sdk'
import type { MessageInstance } from 'antd/es/message/interface'
import type { ChatMessage } from '../types/chat'
import { ElectronChatProvider, type ElectronChatMessage } from '../providers/ElectronChatProvider'
import type { ElectronRequestInput, ElectronRequestOutput } from '../providers/ElectronXRequest'

// 性能优化：内存中最大消息数量
const MAX_MESSAGES_IN_MEMORY = 100

export interface UseChatWithXChatOptions {
  messageApi: MessageInstance
  conversationKey: string | undefined
  /** 历史消息（从数据库加载） */
  historyMessages: ChatMessage[]
  /** 持久化消息到数据库 */
  onSaveMessage: (message: ChatMessage) => Promise<void>
  /** 更新消息到数据库 */
  onUpdateMessage: (key: string, updates: Partial<ChatMessage>) => Promise<void>
}

export interface UseChatWithXChatReturn {
  /** 是否正在请求 */
  isTyping: boolean
  /** 当前会话的消息列表（用于渲染） */
  messages: ChatMessage[]
  /** 发送消息 */
  sendMessage: (question: string, sources?: string[], tags?: string[]) => void
  /** 停止生成 */
  stopGeneration: () => void
}

/**
 * 将 useXChat 的消息状态映射到我们的状态
 */
function mapStatus(status: string): ChatMessage['status'] {
  switch (status) {
    case 'success':
    case 'local':
      return 'success'
    case 'error':
    case 'abort':
      return 'error'
    default:
      return 'pending'
  }
}

/** MessageInfo 的 status 类型 */
type MessageStatus = 'local' | 'loading' | 'updating' | 'success' | 'error' | 'abort'

/**
 * 将 ChatMessage 转换为 useXChat 的消息格式
 */
function toXChatMessage(msg: ChatMessage): {
  message: ElectronChatMessage
  id: string
  status: MessageStatus
} {
  return {
    id: msg.key,
    message: {
      role: msg.role === 'user' ? 'user' : 'assistant',
      content: msg.content,
      sources: msg.sources
    },
    status: msg.status === 'error' ? 'error' : 'local'
  }
}

export function useChatWithXChat({
  messageApi,
  conversationKey,
  historyMessages,
  onSaveMessage,
  onUpdateMessage
}: UseChatWithXChatOptions): UseChatWithXChatReturn {
  // 按照官方文档推荐，使用 useState 保持 Provider 实例稳定
  // https://x.ant.design/x-sdks/chat-provider-cn
  const [provider] = useState(() => new ElectronChatProvider())

  // 性能优化：组件卸载时清理 Provider 和监听器
  useEffect(() => {
    return () => {
      provider.dispose()
    }
  }, [provider])

  // 持久化回调的 ref
  const onSaveMessageRef = useRef(onSaveMessage)
  const onUpdateMessageRef = useRef(onUpdateMessage)

  // 使用 useEffect 更新 ref，避免在渲染期间修改
  useEffect(() => {
    onSaveMessageRef.current = onSaveMessage
    onUpdateMessageRef.current = onUpdateMessage
  })

  // 跟踪是否正在发送消息（用于区分历史加载和新消息）
  const isSendingRef = useRef(false)
  // 跟踪上一次的 conversationKey，用于检测会话切换
  const prevConversationKeyRef = useRef<string | undefined>(undefined)
  // 跟踪已保存的消息 ID，避免重复保存
  const savedMessageIdsRef = useRef<Set<string>>(new Set())

  // 按照官方文档使用 useXChat - 传入 conversationKey 来区分不同会话
  // https://x.ant.design/x-sdks/chat-provider-cn
  const {
    messages: xMessages,
    onRequest,
    abort,
    isRequesting,
    setMessages: setXMessages
  } = useXChat<
    ElectronChatMessage,
    ElectronChatMessage,
    ElectronRequestInput,
    ElectronRequestOutput
  >({
    provider,
    conversationKey,
    requestPlaceholder: { role: 'assistant', content: '' },
    requestFallback: (_, { error }) => ({
      role: 'assistant',
      content: `请求失败：${error.message}`
    })
  })

  // 跟踪上一次加载的历史消息长度，用于检测历史消息是否变化
  const prevHistoryLengthRef = useRef(0)

  // 当会话切换或历史消息加载完成时，加载历史消息到 useXChat
  useEffect(() => {
    // 如果正在发送消息或正在请求，不要覆盖 xMessages
    if (isSendingRef.current || isRequesting) {
      return
    }

    // 检测会话是否切换
    const isConversationChanged = prevConversationKeyRef.current !== conversationKey
    prevConversationKeyRef.current = conversationKey

    if (!conversationKey) {
      setXMessages([])
      savedMessageIdsRef.current.clear()
      prevHistoryLengthRef.current = 0
      return
    }

    // 检测历史消息是否刚加载完成（之前为空或长度变化）
    const historyJustLoaded =
      historyMessages.length > 0 && prevHistoryLengthRef.current !== historyMessages.length
    prevHistoryLengthRef.current = historyMessages.length

    // 在会话切换或历史消息刚加载完成时，加载历史消息
    if (isConversationChanged || historyJustLoaded) {
      // 将历史消息转换为 useXChat 格式
      let xHistoryMessages = historyMessages
        .filter((m) => m.role !== 'system' || m.content.trim()) // 过滤空的系统消息
        .map((msg) => toXChatMessage(msg))

      // 性能优化：限制内存中的消息数量
      if (xHistoryMessages.length > MAX_MESSAGES_IN_MEMORY) {
        xHistoryMessages = xHistoryMessages.slice(-MAX_MESSAGES_IN_MEMORY)
      }

      setXMessages(xHistoryMessages)
      // 将历史消息 ID 标记为已保存
      savedMessageIdsRef.current = new Set(historyMessages.map((m) => m.key))
    }
  }, [conversationKey, historyMessages, setXMessages, isRequesting])

  // 性能优化：定期清理超出限制的消息
  useEffect(() => {
    if (xMessages.length > MAX_MESSAGES_IN_MEMORY && !isRequesting) {
      const trimmedMessages = xMessages.slice(-MAX_MESSAGES_IN_MEMORY)
      setXMessages(trimmedMessages)
    }
  }, [xMessages, isRequesting, setXMessages])

  // 构建历史消息的时间戳映射（用于快速查找）
  const historyTimestampMap = useMemo(() => {
    const map = new Map<string, number>()
    for (const msg of historyMessages) {
      if (msg.timestamp) {
        map.set(msg.key, msg.timestamp)
      }
    }
    return map
  }, [historyMessages])

  // 新消息的时间戳状态（使用 useState 以符合 React 规范）
  const [newMessageTimestamps, setNewMessageTimestamps] = useState<Map<string, number>>(
    () => new Map()
  )

  // 当 xMessages 变化时，为新消息分配时间戳
  useEffect(() => {
    const now = Date.now()
    const updates: [string, number][] = []

    for (const xMsg of xMessages) {
      const id = String(xMsg.id)
      // 只为新消息（msg_ 开头）且尚未有时间戳的分配
      if (id.startsWith('msg_') && !newMessageTimestamps.has(id)) {
        updates.push([id, now])
      }
    }

    if (updates.length > 0) {
      // 需要在消息变化时更新时间戳状态，这是合法的用例
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNewMessageTimestamps((prev) => {
        const next = new Map(prev)
        for (const [id, ts] of updates) {
          next.set(id, ts)
        }
        return next
      })
    }
  }, [xMessages, newMessageTimestamps])

  // 将 xMessages 转换为 ChatMessage 格式用于渲染
  // 使用索引和内容生成唯一 key，避免 useXChat 的 msg_X ID 冲突
  const messages = useMemo<ChatMessage[]>(() => {
    // 1) 按 id 合并：保留同一条消息的最新内容（流式阶段会多次推送）
    type Mapped = {
      key: string
      role: ChatMessage['role']
      content: string
      sources?: ChatMessage['sources']
      suggestedQuestions?: string[]
      typing: boolean
      status: ChatMessage['status']
      timestamp?: number
      idx: number
      id: string
    }
    const latestById = new Map<string, Mapped>()

    xMessages.forEach((xMsg, index) => {
      const id = String(xMsg.id)
      const uniqueKey = id.startsWith('msg_')
        ? `render-${index}-${xMsg.message.content.slice(0, 20)}`
        : id
      const timestamp = historyTimestampMap.get(id) ?? newMessageTimestamps.get(id)

      latestById.set(id, {
        id,
        idx: index, // 用于保持顺序
        key: uniqueKey,
        role: xMsg.message.role === 'user' ? 'user' : 'ai',
        content: xMsg.message.content,
        sources: xMsg.message.sources,
        suggestedQuestions: xMsg.message.suggestedQuestions,
        typing: xMsg.status === 'loading' || xMsg.status === 'updating',
        status: mapStatus(xMsg.status),
        timestamp
      })
    })

    // 2) 还原为数组并按最后出现顺序排序
    const merged = Array.from(latestById.values()).sort((a, b) => a.idx - b.idx)

    // 3) 去重：相同 role+content 的连续重复只保留一条（防止流式重复帧）
    const deduped: ChatMessage[] = []
    for (const msg of merged) {
      const last = deduped[deduped.length - 1]
      if (last && last.role === msg.role && last.content === msg.content) {
        continue
      }
      deduped.push({
        key: msg.key,
        role: msg.role,
        content: msg.content,
        sources: msg.sources,
        suggestedQuestions: msg.suggestedQuestions,
        typing: msg.typing,
        status: msg.status,
        timestamp: msg.timestamp
      })
    }
    return deduped
  }, [xMessages, historyTimestampMap, newMessageTimestamps])

  // 发送消息
  const sendMessage = useCallback(
    (question: string, sources?: string[], tags?: string[]) => {
      if (!question.trim() || isRequesting) return
      if (!conversationKey) {
        messageApi.warning('请先创建或选择一个对话')
        return
      }

      // 标记正在发送消息
      isSendingRef.current = true

      // 使用 onRequest 发送消息
      onRequest({ conversationKey, question: question.trim(), sources, tags })
    },
    [conversationKey, isRequesting, messageApi, onRequest]
  )

  // 使用 ref 跟踪上一次的 isRequesting 状态
  const prevIsRequestingRef = useRef(false)

  // 只在请求完成时进行持久化（isRequesting 从 true 变为 false）
  useEffect(() => {
    // 检测请求状态变化
    const wasRequesting = prevIsRequestingRef.current
    prevIsRequestingRef.current = isRequesting

    // 请求完成（从 true 变为 false）
    if (wasRequesting && !isRequesting) {
      // 延迟重置发送状态
      setTimeout(() => {
        isSendingRef.current = false
      }, 100)

      // 保存新消息到数据库
      if (conversationKey && xMessages.length > 0) {
        // 检查是否需要生成标题 (如果消息数量 <= 2，可能是新对话)
        const isNewConversation = xMessages.length <= 2
        let userQuestion = ''
        let aiAnswer = ''

        for (const xMsg of xMessages) {
          const originalId = String(xMsg.id)
          // 只保存新消息（ID 以 msg_ 开头且未保存过的）
          if (originalId.startsWith('msg_') && !savedMessageIdsRef.current.has(originalId)) {
            savedMessageIdsRef.current.add(originalId)

            // 生成唯一的持久化 ID，避免与 useXChat 生成的 ID 冲突
            const role = xMsg.message.role === 'user' ? 'user' : 'ai'
            const persistKey = `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

            const chatMessage: ChatMessage = {
              key: persistKey,
              role: role,
              content: xMsg.message.content,
              sources: xMsg.message.sources,
              suggestedQuestions: xMsg.message.suggestedQuestions,
              timestamp: Date.now(),
              status: mapStatus(xMsg.status),
              typing: false
            }
            onSaveMessageRef.current(chatMessage)

            if (role === 'user') userQuestion = chatMessage.content
            if (role === 'ai') aiAnswer = chatMessage.content
          }
        }

        // 如果是新对话且有问答，生成标题
        if (isNewConversation && userQuestion && aiAnswer) {
          window.api.generateTitle(conversationKey, userQuestion, aiAnswer).catch(console.error)
        }
      }
    }
  }, [isRequesting, conversationKey, xMessages])

  // 停止生成
  const stopGeneration = useCallback(() => {
    if (isRequesting) {
      abort()
      messageApi.info('已停止生成')
    }
  }, [isRequesting, abort, messageApi])

  return {
    isTyping: isRequesting,
    messages,
    sendMessage,
    stopGeneration
  }
}
