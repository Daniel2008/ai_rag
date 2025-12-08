import { memo, useMemo, useCallback, useRef, useState } from 'react'
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
import type { ChatMessage, ChatSource } from '../../types/chat'

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
}

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
  copiedMessageKey: string | null
  onCopyMessage: (content: string, key: string) => void
  onRetryMessage: (content: string) => void
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

const MessageContent = memo(
  ({ message, copiedMessageKey, onCopyMessage, onRetryMessage, isTyping }: MessageContentProps) => {
    const { token } = antdTheme.useToken()
    const { think, realContent } = useMemo(() => parseContent(message.content), [message.content])
    const hasContent = realContent.trim().length > 0
    const isThinking = message.typing && !hasContent && !!think

    const renderMessageActions = useCallback(() => {
      if (message.role === 'system') return null

      const timeStr = formatTimestamp(message.timestamp)

      return (
        <div className="message-actions flex items-center gap-2 mt-2">
          {/* 时间戳 */}
          {timeStr && (
            <span className="text-xs opacity-60" style={{ color: token.colorTextSecondary }}>
              {timeStr}
            </span>
          )}
          <Tooltip title={copiedMessageKey === message.key ? '已复制' : '复制'}>
            <Button
              type="text"
              size="small"
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
                icon={<ReloadOutlined />}
                onClick={() => onRetryMessage(message.content)}
                disabled={isTyping}
              />
            </Tooltip>
          )}
        </div>
      )
    }, [
      message,
      copiedMessageKey,
      token.colorSuccess,
      token.colorTextSecondary,
      onCopyMessage,
      onRetryMessage,
      isTyping
    ])

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
            {renderMessageActions()}
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
    // 自定义比较逻辑：只有当内容、typing状态、key、复制状态、时间戳、是否正在打字变化时才重渲染
    return (
      prev.message.content === next.message.content &&
      prev.message.typing === next.message.typing &&
      prev.message.key === next.message.key &&
      prev.message.timestamp === next.message.timestamp &&
      prev.copiedMessageKey === next.copiedMessageKey &&
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
  hasMore
}: ChatAreaProps): ReactElement {
  const { token } = antdTheme.useToken()
  const containerRef = useRef<HTMLDivElement>(null)
  const [loadingMore, setLoadingMore] = useState(false)

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
        },
        footer: (_, info) => {
          const sources = info.extraInfo?.sources as ChatSource[] | undefined
          if (!sources?.length) return null
          return (
            <div className="sources-container mt-3">
              <Sources
                inline
                items={sources.map((source, index) => ({
                  key: `${source.fileName}-${index}`,
                  title: source.fileName,
                  icon: <FileTextOutlined />,
                  description: source.pageNumber ? `第 ${source.pageNumber} 页` : undefined
                }))}
                title={
                  <span className="flex items-center gap-2">
                    <DatabaseOutlined />
                    引用来源 ({sources.length})
                  </span>
                }
              />
            </div>
          )
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
    [token, themeMode, userAvatar, aiAvatar, systemAvatar]
  )

  // 构建 Bubble.List 需要的 items 数组
  const bubbleItems = useMemo(() => {
    return currentMessages
      .filter((m) => m.role !== 'system' || m.content.trim().length > 0)
      .map((message) => {
        const { think, realContent } = parseContent(message.content)
        const hasContent = realContent.trim().length > 0
        const typing = message.typing && hasContent
        const loading = message.typing && !hasContent && !think

        return {
          key: message.key,
          role: message.role,
          content: (
            <MessageContent
              message={message}
              copiedMessageKey={copiedMessageKey}
              onCopyMessage={onCopyMessage}
              onRetryMessage={onRetryMessage}
              isTyping={isTyping}
            />
          ),
          typing,
          loading,
          extraInfo: { sources: message.sources, timestamp: message.timestamp }
        }
      })
  }, [currentMessages, isTyping, copiedMessageKey, onCopyMessage, onRetryMessage])

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
        <Bubble.List
          ref={bubbleListRef}
          role={roles}
          autoScroll={!loadingMore}
          items={bubbleItems}
        />
      </div>
    </div>
  )
}

// 移除 RenderBubble，因为我们回到了 items 模式，直接在 useMemo 里构建 item 对象
// MessageContent 保持不变，作为 memo 组件继续发挥作用
