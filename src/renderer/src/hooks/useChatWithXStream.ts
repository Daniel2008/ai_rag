/**
 * 使用 XStream 的聊天 Hook
 * 直接从渲染进程调用 Ollama API，无需通过 IPC
 */

import { useCallback, useRef, useState } from 'react'
import type { MessageInstance } from 'antd/es/message/interface'
import type { ChatMessage, ChatSource } from '../types/chat'
import { createChatController, type OllamaMessage } from '../utils/ollamaStream'

export interface UseChatWithXStreamOptions {
  messageApi: MessageInstance
  conversationKey: string | undefined
  updateCurrentMessages: (updater: (prev: ChatMessage[]) => ChatMessage[]) => void
  createMessageKey: (prefix: string) => string
  /** Ollama 服务地址 */
  ollamaUrl?: string
  /** 模型名称 */
  model?: string
}

export interface UseChatWithXStreamReturn {
  /** 是否正在请求 */
  isTyping: boolean
  /** 发送消息 */
  sendMessage: (question: string, context?: string) => void
  /** 停止生成 */
  stopGeneration: () => void
}

/**
 * 使用 XStream 直接调用 Ollama API 的聊天 Hook
 *
 * 优势：
 * - 不需要通过 Electron IPC
 * - 直接使用 XStream 处理流式响应
 * - 支持中止请求
 *
 * 注意：
 * - 需要在 Ollama 配置中启用 CORS
 * - 或者配置 electron 的 webSecurity
 */
export function useChatWithXStream({
  messageApi,
  conversationKey,
  updateCurrentMessages,
  createMessageKey,
  ollamaUrl = 'http://localhost:11434',
  model = 'qwen2.5'
}: UseChatWithXStreamOptions): UseChatWithXStreamReturn {
  const [isTyping, setIsTyping] = useState(false)
  const chatControllerRef = useRef(createChatController())
  const currentAiKeyRef = useRef<string | null>(null)

  // 发送消息
  const sendMessage = useCallback(
    async (question: string, context?: string) => {
      if (!question.trim() || isTyping) return
      if (!conversationKey) {
        messageApi.warning('请先创建或选择一个对话')
        return
      }

      // 创建消息 key
      const userKey = createMessageKey('user')
      const aiKey = createMessageKey('ai')
      currentAiKeyRef.current = aiKey

      // 创建用户消息
      const userMessage: ChatMessage = {
        key: userKey,
        role: 'user',
        content: question.trim(),
        timestamp: Date.now()
      }

      // 创建 AI 消息占位
      const aiMessage: ChatMessage = {
        key: aiKey,
        role: 'ai',
        content: '',
        typing: true,
        timestamp: Date.now(),
        status: 'pending'
      }

      // 更新 UI
      updateCurrentMessages((prev) => [...prev, userMessage, aiMessage])

      // 持久化到数据库
      await window.api.saveMessage(conversationKey, userMessage)
      await window.api.saveMessage(conversationKey, aiMessage)

      setIsTyping(true)

      // 构建消息列表
      const messages: OllamaMessage[] = []

      // 如果有上下文，添加系统消息
      if (context) {
        messages.push({
          role: 'system',
          content: `You are a helpful assistant. Answer the question based on the following context. If the context doesn't contain relevant information, say so.\n\nContext:\n${context}`
        })
      }

      messages.push({
        role: 'user',
        content: question
      })

      let fullContent = ''

      try {
        await chatControllerRef.current.chat(
          {
            baseUrl: ollamaUrl,
            model,
            messages
          },
          {
            onToken: (token) => {
              fullContent += token
              updateCurrentMessages((prev) =>
                prev.map((m) =>
                  m.key === aiKey
                    ? { ...m, content: fullContent }
                    : m
                )
              )
            },
            onComplete: async (content) => {
              updateCurrentMessages((prev) =>
                prev.map((m) =>
                  m.key === aiKey
                    ? { ...m, content, typing: false, status: 'success' as const }
                    : m
                )
              )

              // 持久化
              await window.api.updateMessage(aiKey, {
                content,
                status: 'success',
                typing: false
              })

              setIsTyping(false)
            },
            onError: async (error) => {
              const errorContent = fullContent || '请求失败'
              updateCurrentMessages((prev) =>
                prev.map((m) =>
                  m.key === aiKey
                    ? { ...m, content: errorContent, typing: false, status: 'error' as const }
                    : m
                )
              )

              // 持久化
              await window.api.updateMessage(aiKey, {
                content: errorContent,
                status: 'error',
                typing: false
              })

              setIsTyping(false)

              // 如果不是用户中止，显示错误
              if (error.name !== 'AbortError') {
                messageApi.error(`请求失败: ${error.message}`)
              }
            }
          }
        )
      } catch (error) {
        // 错误已在 onError 中处理
        console.error('Chat error:', error)
      }
    },
    [
      conversationKey,
      isTyping,
      createMessageKey,
      updateCurrentMessages,
      messageApi,
      ollamaUrl,
      model
    ]
  )

  // 停止生成
  const stopGeneration = useCallback(() => {
    if (isTyping) {
      chatControllerRef.current.abort()
      messageApi.info('已停止生成')

      // 更新当前 AI 消息状态
      if (currentAiKeyRef.current) {
        updateCurrentMessages((prev) =>
          prev.map((m) =>
            m.key === currentAiKeyRef.current
              ? { ...m, typing: false, status: 'success' as const }
              : m
          )
        )
      }

      setIsTyping(false)
    }
  }, [isTyping, messageApi, updateCurrentMessages])

  return {
    isTyping,
    sendMessage,
    stopGeneration
  }
}

