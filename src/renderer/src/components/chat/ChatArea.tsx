import { memo, useMemo, useCallback, useRef, useState, useEffect } from 'react'
import type { ReactElement } from 'react'
import { Bubble, Sources, ThoughtChain } from '@ant-design/x'
import XMarkdown from '@ant-design/x-markdown'
import type { BubbleListRef } from '@ant-design/x/es/bubble'
import type { RoleType } from '@ant-design/x/es/bubble/interface'
import { Avatar, Button, Tooltip, theme as antdTheme } from 'antd'
import {
  FileTextOutlined,
  RobotOutlined,
  CopyOutlined,
  ReloadOutlined,
  UserOutlined,
  BulbOutlined,
  CheckOutlined,
  DatabaseOutlined
} from '@ant-design/icons'
import type { ChatMessage } from '../../types/chat'

interface ChatAreaProps {
  themeMode: 'light' | 'dark'
  currentMessages: ChatMessage[]
  bubbleListRef: React.MutableRefObject<BubbleListRef | null>
  isTyping: boolean
  copiedMessageKey: string | null
  onCopyMessage: (content: string, key: string) => void
  onRetryMessage: (content: string) => void
  onLoadMore?: () => Promise<void>
  hasMore?: boolean
  conversationKey?: string // 用于检测会话切换
}

// 性能优化：最大渲染消息数量，超过此数量只渲染最近的消息
const MAX_RENDERED_MESSAGES = 50

function parseContent(content: string): { think: string | null; realContent: string } {
  const thinkStart = '<think>'
  const thinkEnd = '</think>'

  const startIdx = content.indexOf(thinkStart)
  if (startIdx === -1) {
    return { think: null, realContent: content }
  }

  const endIdx = content.indexOf(thinkEnd, startIdx)
  if (endIdx === -1) {
    // 思考中...
    const think = content.substring(startIdx + thinkStart.length)
    return { think, realContent: '' }
  }

  const think = content.substring(startIdx + thinkStart.length, endIdx)
  const realContent = content.substring(endIdx + thinkEnd.length)
  return { think, realContent }
}

interface MessageContentProps {
  message: ChatMessage
  isTyping: boolean
}

// 格式化时间戳
function formatTimestamp(timestamp?: number): string {
  if (!timestamp) return ''
  const date = new Date(timestamp)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()

  const timeStr = date.toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit'
  })

  if (isToday) {
    return timeStr
  }

  // 如果不是今天，显示日期
  const dateStr = date.toLocaleDateString('zh-CN', {
    month: '2-digit',
    day: '2-digit'
  })
  return `${dateStr} ${timeStr}`
}

// 消息操作按钮组件
interface MessageActionsProps {
  message: ChatMessage
  copiedMessageKey: string | null
  onCopyMessage: (content: string, key: string) => void
  onRetryMessage: (content: string) => void
  isTyping: boolean
}

const MessageActions = memo(
  ({ message, copiedMessageKey, onCopyMessage, onRetryMessage, isTyping }: MessageActionsProps) => {
    const { token } = antdTheme.useToken()

    if (message.role === 'system') return null

    const timeStr = formatTimestamp(message.timestamp)
    const isUserMessage = message.role === 'user'

    return (
      <div
        className={`message-actions flex items-center gap-2 mt-1 ${isUserMessage ? 'justify-end' : ''}`}
      >
        {/* 时间戳 */}
        {timeStr && (
          <span
            className="text-xs"
            style={{
              color: token.colorTextSecondary,
              opacity: 0.6
            }}
          >
            {timeStr}
          </span>
        )}
        <Tooltip title={copiedMessageKey === message.key ? '已复制' : '复制'}>
          <Button
            type="text"
            size="small"
            className={isUserMessage ? 'user-action-btn' : ''}
            icon={
              copiedMessageKey === message.key ? (
                <CheckOutlined style={{ color: token.colorSuccess }} />
              ) : (
                <CopyOutlined />
              )
            }
            onClick={() => onCopyMessage(message.content, message.key)}
          />
        </Tooltip>
        {message.role === 'user' && (
          <Tooltip title="重新发送">
            <Button
              type="text"
              size="small"
              className="user-action-btn"
              icon={<ReloadOutlined />}
              onClick={() => onRetryMessage(message.content)}
              disabled={isTyping}
            />
          </Tooltip>
        )}
      </div>
    )
  }
)

MessageActions.displayName = 'MessageActions'

const MessageContent = memo(
  ({ message }: MessageContentProps) => {
    const { think, realContent } = useMemo(() => parseContent(message.content), [message.content])
    const hasContent = realContent.trim().length > 0
    const isThinking = message.typing && !hasContent && !!think

    return (
      <div className="flex flex-col gap-3">
        {think && (
          <ThoughtChain
            items={[
              {
                key: 'thought',
                title: '思考过程',
                content: <XMarkdown>{think}</XMarkdown>,
                status: isThinking ? 'loading' : 'success'
              }
            ]}
          />
        )}
        {hasContent ? (
          <div className="markdown-content">
            <XMarkdown>{realContent}</XMarkdown>
          </div>
        ) : message.typing && !think ? (
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        ) : !message.typing && !think && !hasContent ? (
          <span className="italic text-gray-400">……</span>
        ) : null}
      </div>
    )
  },
  (prev, next) => {
    // 自定义比较逻辑
    return (
      prev.message.content === next.message.content &&
      prev.message.typing === next.message.typing &&
      prev.message.key === next.message.key &&
      prev.isTyping === next.isTyping
    )
  }
)

MessageContent.displayName = 'MessageContent'

export function ChatArea({
  themeMode,
  currentMessages,
  bubbleListRef,
  isTyping,
  copiedMessageKey,
  onCopyMessage,
  onRetryMessage,
  onLoadMore,
  hasMore,
  conversationKey
}: ChatAreaProps): ReactElement {
  const { token } = antdTheme.useToken()
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const prevConversationKeyRef = useRef<string | undefined>(undefined)
  const prevMessagesLengthRef = useRef(0)
  // 使用 firstKey 来判断消息是否真正属于新会话，解决异步加载时序问题
  const prevFirstKeyRef = useRef<string | undefined>(undefined)
  const needsInitialScrollRef = useRef(false)
  // 跟踪用户是否在底部附近（用于决定是否自动滚动）
  const isNearBottomRef = useRef(true)

  // 检测用户滚动位置
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const checkScrollPosition = (): void => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // 如果距离底部小于 150px，认为用户在底部
      const nearBottom = scrollHeight - scrollTop - clientHeight < 150
      isNearBottomRef.current = nearBottom
    }

    container.addEventListener('scroll', checkScrollPosition, { passive: true })
    return () => container.removeEventListener('scroll', checkScrollPosition)
  }, [])

  // 历史消息加载完成后滚动到底部（根据 Ant Design X 官方文档使用 scrollTo API）
  useEffect(() => {
    // 检测是否切换了会话
    const isNewConversation = conversationKey !== prevConversationKeyRef.current
    // 获取消息的第一条和最后一条 key
    const firstKey = currentMessages[0]?.key
    const lastKey = currentMessages[currentMessages.length - 1]?.key
    // 检测消息数据是否真正更新（firstKey 变化说明是不同会话的数据）
    const isMessagesUpdated = firstKey !== prevFirstKeyRef.current

    if (isNewConversation) {
      prevConversationKeyRef.current = conversationKey
      needsInitialScrollRef.current = true // 标记需要初始滚动
      prevMessagesLengthRef.current = 0 // 重置消息计数
      isNearBottomRef.current = true // 新会话重置为底部
    }

    // 初始滚动条件：需要滚动 + 有消息 + 消息数据已更新 + 非加载更多
    // 关键：通过 isMessagesUpdated 确保是新会话的消息，而不是旧会话残留数据
    const shouldInitialScroll =
      needsInitialScrollRef.current &&
      currentMessages.length > 0 &&
      isMessagesUpdated &&
      !loadingMore

    if (shouldInitialScroll) {
      needsInitialScrollRef.current = false
      prevFirstKeyRef.current = firstKey

      // 滚动任务：使用 key 定位 + top: 'bottom' 双重保障
      const scrollTask = (): void => {
        requestAnimationFrame(() => {
          if (bubbleListRef.current && lastKey) {
            bubbleListRef.current.scrollTo({ key: lastKey, block: 'end', behavior: 'instant' })
            bubbleListRef.current.scrollTo({ top: 'bottom', behavior: 'instant' })
          }
        })
      }

      // 多次尝试，应对 XMarkdown 异步渲染导致的高度变化
      scrollTask()
      setTimeout(scrollTask, 100)
      setTimeout(scrollTask, 300)
      setTimeout(scrollTask, 500)
    }

    // 新消息滚动：非初始滚动阶段 + 消息数量增加 + 用户在底部附近
    const hasNewMessage =
      !needsInitialScrollRef.current &&
      currentMessages.length > prevMessagesLengthRef.current &&
      prevMessagesLengthRef.current > 0

    if (hasNewMessage && !loadingMore && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        if (bubbleListRef.current && lastKey) {
          bubbleListRef.current.scrollTo({ key: lastKey, block: 'end', behavior: 'smooth' })
        }
      })
    }

    // 正在输入时持续滚动（仅当用户在底部附近时）
    if (isTyping && currentMessages.length > 0 && !loadingMore && !needsInitialScrollRef.current && isNearBottomRef.current) {
      requestAnimationFrame(() => {
        if (bubbleListRef.current && lastKey) {
          bubbleListRef.current.scrollTo({ key: lastKey, block: 'end', behavior: 'smooth' })
        }
      })
    }

    // 更新消息长度（用于新消息检测）
    prevMessagesLengthRef.current = currentMessages.length
  }, [conversationKey, currentMessages, isTyping, loadingMore, bubbleListRef])

  // 处理滚动加载
  const handleScroll = useCallback(async () => {
    const container = containerRef.current
    if (!container || !onLoadMore || !hasMore || loadingMore) return

    if (container.scrollTop === 0) {
      setLoadingMore(true)
      const oldScrollHeight = container.scrollHeight

      await onLoadMore()

      // 恢复滚动位置
      requestAnimationFrame(() => {
        if (container) {
          const newScrollHeight = container.scrollHeight
          container.scrollTop = newScrollHeight - oldScrollHeight
        }
      })
      setLoadingMore(false)
    }
  }, [onLoadMore, hasMore, loadingMore])

  // 头像配置
  const userAvatar = useMemo(
    () => (
      <Avatar
        size={36}
        icon={<UserOutlined />}
        style={{
          background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`
        }}
      />
    ),
    [token.colorPrimary]
  )

  const aiAvatar = useMemo(
    () => (
      <Avatar
        size={36}
        icon={<RobotOutlined />}
        style={{
          background:
            themeMode === 'dark'
              ? 'linear-gradient(135deg, #334155 0%, #475569 100%)'
              : 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
          color: token.colorPrimary
        }}
      />
    ),
    [themeMode, token.colorPrimary]
  )

  const systemAvatar = useMemo(
    () => (
      <Avatar
        size={36}
        icon={<BulbOutlined />}
        style={{
          background: token.colorWarningBg,
          color: token.colorWarning
        }}
      />
    ),
    [token.colorWarningBg, token.colorWarning]
  )

  const roles = useMemo<RoleType>(
    () => ({
      user: {
        placement: 'end',
        variant: 'shadow',
        avatar: userAvatar,
        styles: {
          content: {
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
            color: '#fff',
            borderRadius: 16,
            padding: '12px 16px',
            maxWidth: '100%'
          }
        }
      },
      ai: {
        placement: 'start',
        variant: 'filled',
        avatar: aiAvatar,
        styles: {
          content: {
            background: themeMode === 'dark' ? token.colorBgElevated : token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 16,
            padding: '12px 16px',
            maxWidth: '85%'
          }
        }
      },
      system: {
        placement: 'start',
        variant: 'borderless',
        avatar: systemAvatar,
        styles: {
          content: {
            background: token.colorWarningBg,
            borderRadius: 12,
            padding: '8px 12px',
            color: token.colorWarning
          }
        }
      }
    }),
    [
      themeMode,
      userAvatar,
      aiAvatar,
      systemAvatar,
      token.colorPrimary,
      token.colorBgElevated,
      token.colorBgContainer,
      token.colorBorderSecondary,
      token.colorWarningBg,
      token.colorWarning
    ]
  )

  // 构建 Bubble.List 需要的 items 数组
  const bubbleItems = useMemo(() => {
    const filteredMessages = currentMessages.filter(
      (m) => m.role !== 'system' || m.content.trim().length > 0
    )

    const messagesToRender =
      filteredMessages.length > MAX_RENDERED_MESSAGES
        ? filteredMessages.slice(-MAX_RENDERED_MESSAGES)
        : filteredMessages

    return messagesToRender.map((message) => {
      const { think, realContent } = parseContent(message.content)
      const hasContent = realContent.trim().length > 0
      const typing = message.typing && hasContent
      const loading = message.typing && !hasContent && !think

      // 构建 Footer
      const footer = (
        <div className="flex flex-col w-full">
          {message.role === 'ai' && message.sources && message.sources.length > 0 && (
            <div className="sources-container mt-2 mb-1">
              <Sources
                inline
                items={message.sources.map((source, index) => ({
                  key: `${source.fileName}-${index}`,
                  title: source.fileName,
                  icon: <FileTextOutlined />,
                  description: source.pageNumber ? `第 ${source.pageNumber} 页` : undefined
                }))}
                title={
                  <span className="flex items-center gap-2">
                    <DatabaseOutlined />
                    引用来源 ({message.sources.length})
                  </span>
                }
              />
            </div>
          )}
          <MessageActions
            message={message}
            copiedMessageKey={copiedMessageKey}
            onCopyMessage={onCopyMessage}
            onRetryMessage={onRetryMessage}
            isTyping={isTyping}
          />
        </div>
      )

      return {
        key: message.key,
        role: message.role,
        content: <MessageContent message={message} isTyping={isTyping} />,
        typing,
        loading,
        footer
      }
    })
  }, [currentMessages, isTyping, copiedMessageKey, onCopyMessage, onRetryMessage])

  // 计算是否有被截断的消息
  const hasHiddenMessages = useMemo(() => {
    const filteredCount = currentMessages.filter(
      (m) => m.role !== 'system' || m.content.trim().length > 0
    ).length
    return filteredCount > MAX_RENDERED_MESSAGES
  }, [currentMessages])

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="chat-bubble-list flex-1 overflow-y-auto p-6"
      style={{ background: token.colorBgLayout }}
    >
      <div className="max-w-4xl mx-auto">
        {loadingMore && (
          <div className="text-center py-2 text-gray-400 text-sm">加载更多消息...</div>
        )}
        {hasHiddenMessages && !loadingMore && (
          <div className="text-center py-2 text-gray-400 text-sm">
            仅显示最近 {MAX_RENDERED_MESSAGES} 条消息
          </div>
        )}
        <Bubble.List
          ref={bubbleListRef}
          role={roles}
          autoScroll={false}
          items={bubbleItems}
        />
      </div>
    </div>
  )
}
