/**
 * 基于 @ant-design/x-sdk 的聊天数据流管理 Hook
 * 使用 useXChat 统一管理消息状态
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { useXChat } from '@ant-design/x-sdk'
import type { MessageInstance } from 'antd/es/message/interface'
import type { ChatMessage, ChatSource } from '../types/chat'

export interface UseXChatManagerOptions {
  messageApi: MessageInstance
  conversationKey: string | undefined
  initialMessages?: ChatMessage[]
  onMessagesUpdate?: (messages: ChatMessage[]) => void
}

export interface UseXChatManagerReturn {
  /** 当前会话消息列表 */
  messages: ChatMessage[]
  /** 是否正在输入/生成中 */
  isTyping: boolean
  /** 发送消息 */
  sendMessage: (content: string, sources?: string[]) => void
  /** 停止生成 */
  stopGeneration: () => void
  /** 清空消息 */
  clearMessages: () => void
  /** 设置消息 */
  setMessages: (messages: ChatMessage[]) => void
  /** 重试最后一条消息 */
  retryLastMessage: () => void
}

/**
 * 将 XChat 消息转换为 ChatMessage 格式
 */
function convertToDisplayMessage(
  msg: { id: string; message: string; status: string },
  role: 'user' | 'ai',
  extra?: { sources?: ChatSource[]; timestamp?: number }
): ChatMessage {
  return {
    key: msg.id,
    role,
    content: msg.message,
    typing: msg.status === 'loading',
    status: msg.status === 'success' ? 'success' : msg.status === 'error' ? 'error' : 'pending',
    sources: extra?.sources,
    timestamp: extra?.timestamp ?? Date.now()
  }
}

export function useXChatManager({
  messageApi,
  conversationKey,
  initialMessages = [],
  onMessagesUpdate
}: UseXChatManagerOptions): UseXChatManagerReturn {
  const [isTyping, setIsTyping] = useState(false)
  const pendingSourcesRef = useRef<ChatSource[]>([])
  const currentQuestionRef = useRef<string>('')
  const currentSourcesRef = useRef<string[] | undefined>(undefined)
  const idCounterRef = useRef(0)

  // 生成唯一 ID
  const generateId = useCallback((prefix: string) => {
    idCounterRef.current += 1
    return `${prefix}-${Date.now()}-${idCounterRef.current}`
  }, [])

  // 使用 useXChat 管理消息流
  const {
    messages: xMessages,
    setMessages: setXMessages,
    onRequest,
    onSuccess,
    onError
  } = useXChat({
    // 默认助手配置
    defaultMessages: [],
    // 请求处理器
    requestPlaceholder: '正在思考...',
    requestFallback: '请求失败，请重试'
  })

  // 本地消息状态（包含历史消息和新消息）
  const [localMessages, setLocalMessages] = useState<ChatMessage[]>(initialMessages)

  // 当 initialMessages 变化时更新本地消息
  useEffect(() => {
    setLocalMessages(initialMessages)
  }, [initialMessages])

  // 监听 xMessages 变化并同步到本地消息
  useEffect(() => {
    if (xMessages.length === 0) return

    // 将 xChat 的消息转换为 ChatMessage 格式并追加
    const lastXMsg = xMessages[xMessages.length - 1]
    if (!lastXMsg) return

    setLocalMessages((prev) => {
      // 检查消息是否已存在
      const existingIndex = prev.findIndex((m) => m.key === lastXMsg.id)

      if (existingIndex >= 0) {
        // 更新现有消息
        const updated = [...prev]
        updated[existingIndex] = {
          ...updated[existingIndex],
          content: lastXMsg.message,
          typing: lastXMsg.status === 'loading',
          status:
            lastXMsg.status === 'success'
              ? 'success'
              : lastXMsg.status === 'error'
                ? 'error'
                : 'pending',
          sources: pendingSourcesRef.current.length > 0 ? pendingSourcesRef.current : undefined
        }
        return updated
      }
      return prev
    })
  }, [xMessages])

  // 发送消息
  const sendMessage = useCallback(
    async (content: string, sources?: string[]) => {
      if (!content.trim() || isTyping) return
      if (!conversationKey) {
        messageApi.warning('请先创建或选择一个对话')
        return
      }

      currentQuestionRef.current = content
      currentSourcesRef.current = sources
      pendingSourcesRef.current = []

      // 创建用户消息
      const userMessageKey = generateId('user')
      const userMessage: ChatMessage = {
        key: userMessageKey,
        role: 'user',
        content: content.trim(),
        timestamp: Date.now()
      }

      // 创建 AI 消息占位
      const aiMessageKey = generateId('ai')
      const aiMessage: ChatMessage = {
        key: aiMessageKey,
        role: 'ai',
        content: '',
        typing: true,
        timestamp: Date.now(),
        status: 'pending'
      }

      // 更新本地消息
      setLocalMessages((prev) => [...prev, userMessage, aiMessage])

      // 持久化消息
      await window.api.saveMessage(conversationKey, userMessage)
      await window.api.saveMessage(conversationKey, aiMessage)

      setIsTyping(true)

      // 触发 onRequest
      onRequest(aiMessageKey)

      // 内容缓冲
      let contentBuffer = ''

      // 设置监听器
      const handleToken = (token: string): void => {
        contentBuffer += token
        setLocalMessages((prev) =>
          prev.map((m) => (m.key === aiMessageKey ? { ...m, content: contentBuffer } : m))
        )
      }

      const handleSources = (chatSources: ChatSource[]): void => {
        pendingSourcesRef.current = chatSources
      }

      const handleDone = async (): Promise<void> => {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.key === aiMessageKey
              ? {
                  ...m,
                  typing: false,
                  status: 'success' as const,
                  sources: pendingSourcesRef.current
                }
              : m
          )
        )

        // 持久化完成的消息
        await window.api.updateMessage(aiMessageKey, {
          content: contentBuffer,
          sources: pendingSourcesRef.current,
          status: 'success',
          typing: false
        })

        onSuccess(aiMessageKey, contentBuffer)
        setIsTyping(false)
        cleanup()
      }

      const handleError = async (error: string): Promise<void> => {
        setLocalMessages((prev) =>
          prev.map((m) =>
            m.key === aiMessageKey
              ? {
                  ...m,
                  typing: false,
                  status: 'error' as const,
                  content: contentBuffer || '请求失败'
                }
              : m
          )
        )

        // 持久化错误消息
        await window.api.updateMessage(aiMessageKey, {
          content: contentBuffer || '请求失败',
          status: 'error',
          typing: false
        })

        onError(aiMessageKey, new Error(error))
        setIsTyping(false)
        messageApi.error('对话失败，请检查模型服务或日志信息')
        cleanup()
      }

      const cleanup = (): void => {
        window.api.removeAllChatListeners()
        // 重新设置监听器为下一次使用
        setupListeners()
      }

      const setupListeners = (): void => {
        window.api.onChatToken(handleToken)
        window.api.onChatSources(handleSources)
        window.api.onChatDone(handleDone)
        window.api.onChatError(handleError)
      }

      setupListeners()

      // 发送请求
      window.api.chat({ question: content, sources })
    },
    [conversationKey, isTyping, generateId, messageApi, onRequest, onSuccess, onError]
  )

  // 停止生成
  const stopGeneration = useCallback(async () => {
    if (!isTyping) return

    // 找到正在生成的消息
    const typingMessage = localMessages.find((m) => m.typing && m.role === 'ai')
    if (typingMessage) {
      setLocalMessages((prev) =>
        prev.map((m) => (m.key === typingMessage.key ? { ...m, typing: false, status: 'success' } : m))
      )

      // 持久化
      await window.api.updateMessage(typingMessage.key, {
        content: typingMessage.content,
        status: 'success',
        typing: false
      })
    }

    setIsTyping(false)
    messageApi.info('已停止生成')
  }, [isTyping, localMessages, messageApi])

  // 清空消息
  const clearMessages = useCallback(() => {
    setLocalMessages([])
    setXMessages([])
  }, [setXMessages])

  // 设置消息
  const setMessages = useCallback((messages: ChatMessage[]) => {
    setLocalMessages(messages)
  }, [])

  // 重试最后一条消息
  const retryLastMessage = useCallback(() => {
    if (isTyping) return

    // 找到最后一条用户消息
    const lastUserMessage = [...localMessages].reverse().find((m) => m.role === 'user')
    if (lastUserMessage) {
      sendMessage(lastUserMessage.content, currentSourcesRef.current)
    }
  }, [isTyping, localMessages, sendMessage])

  // 当消息变化时通知外部
  useEffect(() => {
    onMessagesUpdate?.(localMessages)
  }, [localMessages, onMessagesUpdate])

  return {
    messages: localMessages,
    isTyping,
    sendMessage,
    stopGeneration,
    clearMessages,
    setMessages,
    retryLastMessage
  }
}

