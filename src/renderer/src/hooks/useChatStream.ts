import { useCallback, useEffect, useRef, useState } from 'react'
import type { MessageInstance } from 'antd/es/message/interface'
import type { ChatMessage, ChatSource } from '../types/chat'

export interface UseChatStreamOptions {
  messageApi: MessageInstance
  updateCurrentMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  createMessageKey: (prefix: string) => string
}

export interface UseChatStreamReturn {
  isTyping: boolean
  setIsTyping: (typing: boolean) => void
  streamMessageKeyRef: React.MutableRefObject<string | null>
  pendingSourcesRef: React.MutableRefObject<ChatSource[]>
  handleStopGeneration: () => void
}

export function useChatStream({
  messageApi,
  updateCurrentMessages,
  createMessageKey
}: UseChatStreamOptions): UseChatStreamReturn {
  const [isTyping, setIsTyping] = useState(false)
  const streamMessageKeyRef = useRef<string | null>(null)
  const pendingSourcesRef = useRef<ChatSource[]>([])
  const contentBufferRef = useRef<string>('')

  // 使用 ref 存储回调函数的最新引用，避免 useEffect 重新执行
  const updateCurrentMessagesRef = useRef(updateCurrentMessages)
  const createMessageKeyRef = useRef(createMessageKey)
  const messageApiRef = useRef(messageApi)

  // 每次渲染时更新 ref
  updateCurrentMessagesRef.current = updateCurrentMessages
  createMessageKeyRef.current = createMessageKey
  messageApiRef.current = messageApi

  // 停止生成
  const handleStopGeneration = useCallback(() => {
    if (streamMessageKeyRef.current) {
      updateCurrentMessagesRef.current((prev) =>
        prev.map((message) =>
          message.key === streamMessageKeyRef.current
            ? { ...message, typing: false, status: 'success' as const }
            : message
        )
      )
      
      // 保存当前生成的内容到数据库
      window.api.updateMessage(streamMessageKeyRef.current, {
        content: contentBufferRef.current,
        status: 'success',
        typing: false
      })

      streamMessageKeyRef.current = null
      contentBufferRef.current = ''
      setIsTyping(false)
      messageApiRef.current.info('已停止生成')
    }
  }, [])

  // 只在组件挂载时注册事件监听器，卸载时移除
  useEffect(() => {
    const handleToken = (tokenChunk: string): void => {
      contentBufferRef.current += tokenChunk
      updateCurrentMessagesRef.current((prev) =>
        prev.map((message) =>
          message.key === streamMessageKeyRef.current
            ? { ...message, content: message.content + tokenChunk }
            : message
        )
      )
    }

    const handleSources = (sources: ChatSource[]): void => {
      pendingSourcesRef.current = sources
    }

    const handleDone = (): void => {
      if (streamMessageKeyRef.current) {
        updateCurrentMessagesRef.current((prev) =>
          prev.map((message) =>
            message.key === streamMessageKeyRef.current
              ? { ...message, typing: false, sources: pendingSourcesRef.current, status: 'success' }
              : message
          )
        )
        
        // 保存最终消息到数据库
        window.api.updateMessage(streamMessageKeyRef.current, {
          content: contentBufferRef.current,
          sources: pendingSourcesRef.current,
          status: 'success',
          typing: false
        })
      }
      pendingSourcesRef.current = []
      contentBufferRef.current = ''
      streamMessageKeyRef.current = null
      setIsTyping(false)
    }

    const handleError = (error: string): void => {
      updateCurrentMessagesRef.current((prev) => {
        const updated = prev.map((message) =>
          message.key === streamMessageKeyRef.current
            ? {
                ...message,
                typing: false,
                status: 'error' as const,
                content: message.content || '请求失败'
              }
            : message
        )
        return [
          ...updated,
          {
            key: createMessageKeyRef.current('error'),
            role: 'system' as const,
            content: `⚠️ 发生错误：${error}`,
            timestamp: Date.now(),
            status: 'error' as const
          }
        ]
      })
      
      // 更新出错的消息
      if (streamMessageKeyRef.current) {
        window.api.updateMessage(streamMessageKeyRef.current, {
          content: contentBufferRef.current || '请求失败',
          status: 'error',
          typing: false
        })
      }
      
      pendingSourcesRef.current = []
      contentBufferRef.current = ''
      streamMessageKeyRef.current = null
      setIsTyping(false)
      messageApiRef.current.error('对话失败，请检查模型服务或日志信息')
    }

    window.api.onChatToken(handleToken)
    window.api.onChatSources(handleSources)
    window.api.onChatDone(handleDone)
    window.api.onChatError(handleError)

    return () => {
      window.api.removeAllChatListeners()
    }
  }, []) // 空依赖数组，只在挂载/卸载时执行

  return {
    isTyping,
    setIsTyping,
    streamMessageKeyRef,
    pendingSourcesRef,
    handleStopGeneration
  }
}
