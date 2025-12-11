import { memo, useMemo, useCallback, useRef, useState, useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Bubble, ThoughtChain } from '@ant-design/x'
import XMarkdown from '@ant-design/x-markdown'
import type { BubbleListRef } from '@ant-design/x/es/bubble'
import type { RoleType } from '@ant-design/x/es/bubble/interface'
import { Avatar, Button, Tooltip, Progress, Tag, Collapse, theme as antdTheme, FloatButton } from 'antd'
import {
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileMarkdownOutlined,
  GlobalOutlined,
  RobotOutlined,
  CopyOutlined,
  ReloadOutlined,
  UserOutlined,
  BulbOutlined,
  CheckOutlined,
  DatabaseOutlined,
  SearchOutlined,
  OrderedListOutlined,
  EditOutlined,
  FileOutlined,
  LoadingOutlined,
  LinkOutlined,
  ClockCircleOutlined
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
  conversationKey?: string // 用于检测会话切换
}

// 性能优化：最大渲染消息数量，超过此数量只渲染最近的消息
const MAX_RENDERED_MESSAGES = 50

/** 获取文件类型图标 */
function getFileTypeIcon(fileType?: ChatSource['fileType']): ReactElement {
  switch (fileType) {
    case 'pdf':
      return <FilePdfOutlined style={{ color: '#ff4d4f' }} />
    case 'word':
      return <FileWordOutlined style={{ color: '#1890ff' }} />
    case 'markdown':
      return <FileMarkdownOutlined style={{ color: '#52c41a' }} />
    case 'url':
      return <GlobalOutlined style={{ color: '#722ed1' }} />
    case 'text':
      return <FileTextOutlined style={{ color: '#faad14' }} />
    default:
      return <FileOutlined />
  }
}

/** 获取文件类型标签颜色 */
function getFileTypeColor(fileType?: ChatSource['fileType']): string {
  switch (fileType) {
    case 'pdf':
      return 'red'
    case 'word':
      return 'blue'
    case 'markdown':
      return 'green'
    case 'url':
      return 'purple'
    case 'text':
      return 'orange'
    default:
      return 'default'
  }
}

/** 格式化时间 */
function formatTime(dateStr?: string): string {
  if (!dateStr) return ''
  try {
    const date = new Date(dateStr)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))

    if (days === 0) return '今天'
    if (days === 1) return '昨天'
    if (days < 7) return `${days}天前`
    return date.toLocaleDateString('zh-CN')
  } catch {
    return ''
  }
}

/** 自定义引用来源显示组件 */
const SourcesDisplay = memo(({ sources }: { sources: ChatSource[] }): ReactElement => {
  const { token } = antdTheme.useToken()

  const items = sources.map((source, index) => ({
    key: `source-${index}`,
    label: (
      <div className="flex items-center gap-2 w-full">
        {getFileTypeIcon(source.fileType)}
        <span className="flex-1 truncate font-medium">{source.fileName}</span>
        {source.score !== undefined && (
          <Progress
            percent={Math.round(source.score * 100)}
            size="small"
            style={{ width: 60 }}
            strokeColor={
              source.score > 0.7 ? '#52c41a' : source.score > 0.5 ? '#faad14' : '#ff4d4f'
            }
            format={(percent): string => `${percent}%`}
          />
        )}
      </div>
    ),
    children: (
      <div className="space-y-2 text-sm">
        {/* 元信息标签 */}
        <div className="flex flex-wrap gap-1">
          {source.fileType && (
            <Tag color={getFileTypeColor(source.fileType)} style={{ margin: 0 }}>
              {source.fileType === 'url' ? '网页' : source.fileType.toUpperCase()}
            </Tag>
          )}
          {source.pageNumber && source.pageNumber > 0 && (
            <Tag color="cyan" style={{ margin: 0 }}>
              第 {source.pageNumber} 页
            </Tag>
          )}
          {source.sourceType === 'url' && source.siteName && (
            <Tag icon={<GlobalOutlined />} style={{ margin: 0 }}>
              {source.siteName}
            </Tag>
          )}
        </div>

        {/* 引用内容预览 */}
        <div
          className="p-2 rounded text-xs leading-relaxed"
          style={{
            background: token.colorFillQuaternary,
            color: token.colorTextSecondary,
            maxHeight: 100,
            overflow: 'auto'
          }}
        >
          {source.content}
        </div>

        {/* 底部信息 */}
        <div className="flex items-center gap-3 text-xs" style={{ color: token.colorTextTertiary }}>
          {source.sourceType === 'url' && source.url && (
            <Tooltip title={source.url}>
              <span className="flex items-center gap-1 cursor-pointer hover:text-blue-500">
                <LinkOutlined />
                <span className="truncate max-w-[200px]">{source.url}</span>
              </span>
            </Tooltip>
          )}
          {source.filePath && source.sourceType !== 'url' && (
            <Tooltip title={source.filePath}>
              <span className="flex items-center gap-1">
                <FileOutlined />
                <span className="truncate max-w-[200px]">{source.filePath}</span>
              </span>
            </Tooltip>
          )}
          {source.fetchedAt && (
            <span className="flex items-center gap-1">
              <ClockCircleOutlined />
              {formatTime(source.fetchedAt)}
            </span>
          )}
        </div>
      </div>
    )
  }))

  return (
    <div className="sources-detail mt-2">
      <div
        className="flex items-center gap-2 mb-2 text-sm font-medium"
        style={{ color: token.colorTextSecondary }}
      >
        <DatabaseOutlined />
        <span>引用来源 ({sources.length})</span>
      </div>
      <Collapse
        items={items}
        size="small"
        bordered={false}
        style={{
          background: token.colorFillAlter,
          borderRadius: token.borderRadius
        }}
        expandIconPosition="end"
      />
    </div>
  )
})

SourcesDisplay.displayName = 'SourcesDisplay'

/** 思维链步骤类型（与 Ant Design X ThoughtChain 兼容） */
interface ThoughtStep {
  id: string
  title: string
  status: 'loading' | 'success' | 'error' | 'abort'
  content?: string
  icon?: string
}

/** 获取步骤图标 */
function getStepIcon(iconName?: string, status?: string): ReactNode {
  if (status === 'loading') {
    return <LoadingOutlined spin />
  }
  switch (iconName) {
    case 'FileText':
      return <FileTextOutlined />
    case 'Search':
      return <SearchOutlined />
    case 'Database':
      return <DatabaseOutlined />
    case 'OrderedList':
      return <OrderedListOutlined />
    case 'Edit':
      return <EditOutlined />
    case 'File':
      return <FileOutlined />
    case 'Check':
      return <CheckOutlined />
    default:
      return <BulbOutlined />
  }
}

/** 解析思维链步骤标记 */
function parseThoughtSteps(thinkContent: string): ThoughtStep[] {
  const stepRegex = /\[STEP:([^:]+):([^:]+):([^:]+):([^\]]*)\]([\s\S]*?)\[\/STEP\]/g
  const steps: Map<string, ThoughtStep> = new Map()

  let match
  while ((match = stepRegex.exec(thinkContent)) !== null) {
    const [, id, title, status, icon, content] = match
    // 用 id 作为 key，后面的会覆盖前面的（保留最新状态）
    steps.set(id, {
      id,
      title,
      status: status as ThoughtStep['status'],
      content: content.trim(),
      icon
    })
  }

  return Array.from(steps.values())
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

    // 解析结构化的思维链步骤
    const thoughtItems = useMemo(() => {
      if (!think) return []

      const steps = parseThoughtSteps(think)

      // 如果有结构化步骤，使用结构化显示
      if (steps.length > 0) {
        return steps.map((step) => ({
          key: step.id,
          title: step.title,
          description: step.content,
          status: step.status === 'loading' && !message.typing ? 'success' : step.status,
          icon: getStepIcon(step.icon, step.status),
          collapsible: !!(step.content && step.content.length > 50)
        }))
      }

      // 否则使用旧的方式（纯文本）
      return [
        {
          key: 'thought',
          title: '思考过程',
          content: <XMarkdown>{think}</XMarkdown>,
          status: isThinking ? ('loading' as const) : ('success' as const)
        }
      ]
    }, [think, isThinking, message.typing])

    return (
      <div className="flex flex-col gap-3">
        {think && thoughtItems.length > 0 && <ThoughtChain items={thoughtItems} />}
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
  const [showScrollToBottom, setShowScrollToBottom] = useState(false)

  // 检测用户滚动位置
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const checkScrollPosition = (): void => {
      const { scrollTop, scrollHeight, clientHeight } = container
      // 如果距离底部小于 150px，认为用户在底部
      const nearBottom = scrollHeight - scrollTop - clientHeight < 150
      isNearBottomRef.current = nearBottom
      setShowScrollToBottom(!nearBottom)
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
    if (
      isTyping &&
      currentMessages.length > 0 &&
      !loadingMore &&
      !needsInitialScrollRef.current &&
      isNearBottomRef.current
    ) {
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

  const scrollToBottom = useCallback(() => {
    const lastKey = currentMessages[currentMessages.length - 1]?.key
    requestAnimationFrame(() => {
      if (bubbleListRef.current && lastKey) {
        bubbleListRef.current.scrollTo({ key: lastKey, block: 'end', behavior: 'smooth' })
      }
      if (containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight
      }
    })
  }, [bubbleListRef, currentMessages])

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
            <SourcesDisplay sources={message.sources} />
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
        <Bubble.List ref={bubbleListRef} role={roles} autoScroll={false} items={bubbleItems} />
      </div>
      {showScrollToBottom && (
        <FloatButton
          type="primary"
          onClick={scrollToBottom}
          tooltip="回到底部"
          style={{ position: 'fixed', right: 32, bottom: 168 }}
        />
      )}
    </div>
  )
}
