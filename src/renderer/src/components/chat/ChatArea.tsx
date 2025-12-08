import { memo, useMemo, useCallback, useRef } from 'react'
import type { ReactElement } from 'react'
import { Bubble, type BubbleItemType, Sources, ThoughtChain } from '@ant-design/x'
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

const MessageContent = memo(
  ({ message, copiedMessageKey, onCopyMessage, onRetryMessage, isTyping }: MessageContentProps) => {
    const { token } = antdTheme.useToken()
    const { think, realContent } = useMemo(() => parseContent(message.content), [message.content])
    const hasContent = realContent.trim().length > 0
    const isThinking = message.typing && !hasContent && !!think

    const renderMessageActions = useCallback(() => {
      if (message.role === 'system') return null

      return (
        <div className="message-actions flex items-center gap-1 mt-2">
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
    }, [message, copiedMessageKey, token.colorSuccess, onCopyMessage, onRetryMessage, isTyping])

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
    // 自定义比较逻辑：只有当内容、typing状态、key、复制状态、是否正在打字变化时才重渲染
    return (
      prev.message.content === next.message.content &&
      prev.message.typing === next.message.typing &&
      prev.message.key === next.message.key &&
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
  onRetryMessage
}: ChatAreaProps): ReactElement {
  const { token } = antdTheme.useToken()

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

  // 使用 ref 缓存生成的 BubbleItem，避免每次 render 都重新生成新的 JSX 对象
  const bubbleItemsCache = useRef<
    Map<string, { message: ChatMessage; item: BubbleItemType; isTyping: boolean }>
  >(new Map())

  const bubbleItems = useMemo<BubbleItemType[]>(() => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const cache = bubbleItemsCache.current

    return currentMessages
      .filter((m) => m.role !== 'system' || m.content.trim().length > 0)
      .map((message) => {
        const cached = cache.get(message.key)

        if (cached && cached.message === message && cached.isTyping === isTyping) {
          return cached.item
        }

        const { think, realContent } = parseContent(message.content)
        const hasContent = realContent.trim().length > 0

        const newItem: BubbleItemType = {
          key: message.key,
          role: message.role,
          placement: message.role === 'user' ? ('end' as const) : ('start' as const),
          avatar:
            message.role === 'user'
              ? userAvatar
              : message.role === 'ai'
                ? aiAvatar
                : systemAvatar,
          content: (
            <MessageContent
              message={message}
              copiedMessageKey={copiedMessageKey}
              onCopyMessage={onCopyMessage}
              onRetryMessage={onRetryMessage}
              isTyping={isTyping}
            />
          ),
          // 只有在确实是打字状态且有内容时才启用 typing 效果
          typing: message.typing && hasContent,
          loading: message.typing && !hasContent && !think,
          extraInfo: { sources: message.sources, timestamp: message.timestamp }
        }

        cache.set(message.key, { message, item: newItem, isTyping })

        return newItem
      })
  }, [
    currentMessages,
    userAvatar,
    aiAvatar,
    systemAvatar,
    copiedMessageKey,
    onCopyMessage,
    onRetryMessage,
    isTyping
  ])

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

  return (
    <div
      className="chat-bubble-list flex-1 overflow-y-auto p-6"
      style={{ background: token.colorBgLayout }}
    >
      <div className="max-w-4xl mx-auto">
        <Bubble.List
          ref={bubbleListRef}
          items={bubbleItems}
          role={roles}
          autoScroll
        />
      </div>
    </div>
  )
}