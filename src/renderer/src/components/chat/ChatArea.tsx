import { memo, useMemo, useCallback, useRef, useState, useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Bubble, ThoughtChain, Prompts, Sources, Actions } from '@ant-design/x'
import { XMarkdown } from '@ant-design/x-markdown'
import type { BubbleListRef } from '@ant-design/x/es/bubble'
import type { RoleType } from '@ant-design/x/es/bubble/interface'
import {
  Avatar,
  Button,
  Input,
  Modal,
  Tooltip,
  Progress,
  Tag,
  theme as antdTheme,
  FloatButton
} from 'antd'
import {
  FileTextOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileMarkdownOutlined,
  FileExcelOutlined,
  FilePptOutlined,
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
  ClockCircleOutlined,
  SoundOutlined,
  StopOutlined,
  StarFilled,
  StarOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined
} from '@ant-design/icons'
import { Drawer, List, Select } from 'antd'
import { BarChartOutlined } from '@ant-design/icons'
import { useMemo as useMemoReact } from 'react'
import type { ChatMessage, ChatSource } from '../../types/chat'

interface ChatAreaProps {
  themeMode: 'light' | 'dark'
  currentMessages: ChatMessage[]
  bubbleListRef: React.RefObject<BubbleListRef | null>
  isTyping: boolean
  copiedMessageKey: string | null
  onCopyMessage: (content: string, key: string) => void
  onRetryMessage: (content: string) => void
  onLoadMore?: () => Promise<void>
  hasMore?: boolean
  conversationKey?: string // 用于检测会话切换
  conversationLabel?: string
  isConversationStarred?: boolean
  onRenameConversation?: (key: string, label: string) => Promise<void>
  onToggleStarConversation?: (key: string) => void
  onPromptClick?: (question: string) => void
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
    case 'excel':
      return <FileExcelOutlined style={{ color: '#52c41a' }} />
    case 'ppt':
      return <FilePptOutlined style={{ color: '#fa8c16' }} />
    case 'url':
      return <GlobalOutlined style={{ color: '#722ed1' }} />
    case 'text':
      return <FileTextOutlined style={{ color: '#faad14' }} />
    default:
      return <FileOutlined />
  }
}

/** 根据文件名猜测文件类型 */
function guessFileType(fileName: string): ChatSource['fileType'] {
  if (!fileName) return 'text'
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'doc':
    case 'docx':
      return 'word'
    case 'md':
    case 'markdown':
      return 'markdown'
    case 'xls':
    case 'xlsx':
    case 'csv':
      return 'excel'
    case 'ppt':
    case 'pptx':
      return 'ppt'
    default:
      return 'text'
  }
}

function toLowerSafe(value: string | undefined): string {
  return (value ?? '').trim().toLowerCase()
}

function decodeNamePart(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function extractNameFromPath(path: string): string {
  const part = path.split(/[\\/]/).pop() ?? path
  return decodeNamePart(part)
}

function extractNameFromUrl(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    if (last) return decodeNamePart(last)
    return u.hostname
  } catch {
    return url
  }
}

function deriveSourceId(source: ChatSource): string {
  if (source.filePath) return source.filePath.replace(/\\/g, '/')
  if (source.sourceType === 'url' && source.url) return source.url
  const nameLower = toLowerSafe(source.fileName)
  if (nameLower && nameLower !== 'unknown') return source.fileName
  if (source.fileName) return source.fileName
  return 'unknown'
}

function deriveSourceDisplayName(source: ChatSource): string {
  const nameLower = toLowerSafe(source.fileName)
  if (nameLower && nameLower !== 'unknown') return source.fileName
  if (source.sourceType === 'url') {
    if (source.siteName?.trim()) return source.siteName
    if (source.url) return extractNameFromUrl(source.url)
    return '网页'
  }
  if (source.filePath) return extractNameFromPath(source.filePath)
  return '引用来源'
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
    case 'excel':
      return 'green'
    case 'ppt':
      return 'orange'
    case 'url':
      return 'purple'
    case 'text':
      return 'orange'
    default:
      return 'default'
  }
}

/** 格式化时间 */
function formatTime(dateStr?: string | number): string {
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

/** 合并后的文件来源类型 */
interface MergedSource {
  id: string
  fileName: string
  fileType?: ChatSource['fileType']
  filePath?: string
  sourceType?: ChatSource['sourceType']
  siteName?: string
  url?: string
  fetchedAt?: string | number
  maxScore: number
  avgScore: number
  chunks: Array<{
    content: string
    pageNumber?: number
    score: number
  }>
}

/** 将同一文件的来源合并 */
function mergeSourcesByFile(sources: ChatSource[]): MergedSource[] {
  const byFile = new Map<string, MergedSource>()

  for (const source of sources) {
    const key = deriveSourceId(source)
    const existing = byFile.get(key)

    if (existing) {
      // 添加新的内容片段
      existing.chunks.push({
        content: source.content || '',
        pageNumber: source.pageNumber,
        score: source.score || 0
      })
      // 更新最高分
      existing.maxScore = Math.max(existing.maxScore, source.score || 0)

      const nextName = deriveSourceDisplayName(source)
      if (toLowerSafe(existing.fileName) === 'unknown' && toLowerSafe(nextName) !== 'unknown') {
        existing.fileName = nextName
      }

      const nextRawType = source.fileType
      const nextType =
        nextRawType && nextRawType !== 'unknown'
          ? nextRawType
          : source.sourceType === 'url'
            ? 'url'
            : guessFileType(source.fileName)
      if (!existing.fileType || existing.fileType === 'unknown') {
        existing.fileType = nextType
      }
    } else {
      // 创建新的合并来源
      const displayName = deriveSourceDisplayName(source)
      const rawType = source.fileType
      const type =
        rawType && rawType !== 'unknown'
          ? rawType
          : source.sourceType === 'url'
            ? 'url'
            : guessFileType(source.fileName)

      byFile.set(key, {
        id: key,
        fileName: displayName,
        fileType: type,
        filePath: source.filePath,
        sourceType: source.sourceType,
        siteName: source.siteName,
        url: source.url,
        fetchedAt: source.fetchedAt,
        maxScore: source.score || 0,
        avgScore: 0,
        chunks: [
          {
            content: source.content || '',
            pageNumber: source.pageNumber,
            score: source.score || 0
          }
        ]
      })
    }
  }

  // 计算平均分并按最高分排序
  const result = Array.from(byFile.values())
  for (const item of result) {
    item.avgScore = item.chunks.reduce((sum, c) => sum + c.score, 0) / item.chunks.length
    // 按分数降序排序chunks
    item.chunks.sort((a, b) => b.score - a.score)
  }

  return result.sort((a, b) => b.maxScore - a.maxScore)
}

const SourcesDisplay = memo(({ sources }: { sources: ChatSource[] }): ReactElement => {
  const { token } = antdTheme.useToken()
  const mergedSources = useMemo(() => mergeSourcesByFile(sources), [sources])
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState<string>(() => mergedSources[0]?.id ?? '')
  const [popoverOverlayWidth, setPopoverOverlayWidth] = useState(360)

  useEffect(() => {
    const compute = (): void => {
      const w = typeof window !== 'undefined' ? window.innerWidth : 360
      const next = Math.min(360, Math.max(240, w - 48))
      setPopoverOverlayWidth(next)
    }
    compute()
    window.addEventListener('resize', compute, { passive: true })
    return () => window.removeEventListener('resize', compute)
  }, [])

  const activeKey = useMemo(() => {
    if (!mergedSources.length) return ''
    const exists = mergedSources.some((s) => s.id === active)
    if (exists) return active
    return mergedSources[0]?.id ?? ''
  }, [active, mergedSources])

  const items = useMemo(
    () =>
      mergedSources.map((s) => ({
        key: s.id,
        title: s.fileName,
        url: s.sourceType === 'url' ? s.url : undefined,
        icon: getFileTypeIcon(s.fileType),
        description: (
          <span style={{ color: token.colorTextSecondary }}>
            {s.chunks.length} 段 · 最高相关度 {Math.round((s.maxScore || 0) * 100)}%
          </span>
        )
      })),
    [mergedSources, token.colorTextSecondary]
  )

  const activeSource = useMemo(() => {
    return mergedSources.find((s) => s.id === activeKey) ?? mergedSources[0]
  }, [mergedSources, activeKey])

  // 抽屉内的来源切换
  const switchSource = useCallback(
    (direction: 'prev' | 'next') => {
      const currentIndex = mergedSources.findIndex((s) => s.id === activeKey)
      if (currentIndex === -1) return

      if (direction === 'prev' && currentIndex > 0) {
        setActive(mergedSources[currentIndex - 1].id)
      } else if (direction === 'next' && currentIndex < mergedSources.length - 1) {
        setActive(mergedSources[currentIndex + 1].id)
      }
    },
    [mergedSources, activeKey]
  )

  return (
    <div className="sources-detail mt-2">
      <div className="flex items-center justify-between gap-2">
        <Sources
          inline
          title={
            <span style={{ color: token.colorTextSecondary }}>
              引用来源（{mergedSources.length}）
            </span>
          }
          items={items}
          activeKey={activeKey}
          popoverOverlayWidth={popoverOverlayWidth}
          onClick={(item: unknown) => {
            const itemObj =
              item && typeof item === 'object' ? (item as Record<string, unknown>) : undefined
            const nextKey =
              typeof item === 'string' ? item : String(itemObj?.key ?? itemObj?.id ?? '')
            if (nextKey) {
              // 先更新active状态，再打开抽屉
              setActive(nextKey)
              // 使用小延迟确保状态更新后再打开抽屉
              setTimeout(() => {
                setOpen(true)
              }, 50)
            }
          }}
        />
        <Button
          type="link"
          size="small"
          disabled={!mergedSources.length}
          onClick={() => {
            // 确保有选中的来源
            if (mergedSources.length > 0) {
              // 如果当前active为空或无效，选择第一个
              const current = mergedSources.find((s) => s.id === active)
              if (!current && mergedSources[0]) {
                setActive(mergedSources[0].id)
              }
              setOpen(true)
            }
          }}
          style={{ paddingInline: 4 }}
        >
          详情
        </Button>
      </div>

      <Drawer
        title={
          <div className="flex items-center justify-between gap-2">
            <span>引用来源详情</span>
            {mergedSources.length > 1 && (
              <div className="flex items-center gap-2">
                <span style={{ color: token.colorTextSecondary, fontSize: 12 }}>
                  {mergedSources.findIndex((s) => s.id === activeKey) + 1}/{mergedSources.length}
                </span>
                <Button
                  size="small"
                  type="text"
                  disabled={mergedSources.findIndex((s) => s.id === activeKey) === 0}
                  onClick={() => switchSource('prev')}
                  icon={<ArrowLeftOutlined />}
                />
                <Button
                  size="small"
                  type="text"
                  disabled={
                    mergedSources.findIndex((s) => s.id === activeKey) === mergedSources.length - 1
                  }
                  onClick={() => switchSource('next')}
                  icon={<ArrowRightOutlined />}
                />
                <Select
                  size="small"
                  style={{ width: 180 }}
                  value={activeKey}
                  onChange={(value) => setActive(value)}
                  options={mergedSources.map((s, idx) => ({
                    value: s.id,
                    label: `${idx + 1}. ${s.fileName}`
                  }))}
                />
              </div>
            )}
          </div>
        }
        placement="bottom"
        open={open}
        onClose={() => setOpen(false)}
        styles={{ wrapper: { height: '60vh' } }}
      >
        {activeSource && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-2 items-center">
              <Tag color={getFileTypeColor(activeSource.fileType)} style={{ margin: 0 }}>
                {activeSource.fileType === 'url'
                  ? '网页'
                  : (activeSource.fileType || 'unknown').toUpperCase()}
              </Tag>
              <Tag color="blue" style={{ margin: 0 }}>
                {activeSource.chunks.length} 段
              </Tag>
              <Progress
                percent={Math.round((activeSource.maxScore || 0) * 100)}
                size="small"
                style={{ width: 120 }}
                strokeColor={
                  (activeSource.maxScore || 0) > 0.7
                    ? '#52c41a'
                    : (activeSource.maxScore || 0) > 0.5
                      ? '#faad14'
                      : '#ff4d4f'
                }
                format={(p): string => `${p}%`}
              />
              <span style={{ color: token.colorTextTertiary }}>
                平均相关度 {Math.round((activeSource.avgScore || 0) * 100)}%
              </span>
            </div>

            <div
              className="flex items-center gap-3 text-xs"
              style={{ color: token.colorTextTertiary }}
            >
              {activeSource.sourceType === 'url' && activeSource.url && (
                <Tooltip title={activeSource.url}>
                  <span className="flex items-center gap-1 cursor-pointer hover:text-blue-500">
                    <LinkOutlined />
                    <span className="truncate max-w-[360px]">{activeSource.url}</span>
                  </span>
                </Tooltip>
              )}
              {activeSource.filePath && activeSource.sourceType !== 'url' && (
                <Tooltip title={activeSource.filePath}>
                  <span className="flex items-center gap-1">
                    <FileOutlined />
                    <span className="truncate max-w-[360px]">{activeSource.filePath}</span>
                  </span>
                </Tooltip>
              )}
              {activeSource.fetchedAt && (
                <span className="flex items-center gap-1">
                  <ClockCircleOutlined />
                  {formatTime(activeSource.fetchedAt)}
                </span>
              )}
            </div>

            <div className="space-y-2">
              {activeSource.chunks.map((chunk, idx) => (
                <div
                  key={idx}
                  className="p-3 rounded text-xs leading-relaxed"
                  style={{
                    background: token.colorFillQuaternary,
                    border: `1px solid ${token.colorBorderSecondary}`
                  }}
                >
                  <div
                    className="flex items-center gap-2 mb-2"
                    style={{ color: token.colorTextTertiary }}
                  >
                    {chunk.pageNumber && chunk.pageNumber > 0 && (
                      <Tag color="cyan" style={{ margin: 0, fontSize: 10 }}>
                        第 {chunk.pageNumber} 页
                      </Tag>
                    )}
                    <span className="ml-auto">相关度: {Math.round((chunk.score || 0) * 100)}%</span>
                  </div>
                  <div style={{ color: token.colorTextSecondary }}>{chunk.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Drawer>
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
  const thinkStart = '</think>'
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

function toSpeechText(markdown: string): string {
  const withoutCodeBlocks = markdown.replace(/```[\s\S]*?```/g, ' ')
  const withoutImages = withoutCodeBlocks.replace(/!\[([^\]]*)\]\([^)]+\)/g, '$1')
  const withLinkText = withoutImages.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
  const withoutInlineCode = withLinkText.replace(/`([^`]+)`/g, '$1')
  const withoutQuotePrefix = withoutInlineCode.replace(/^\s{0,3}>\s?/gm, '')
  const withoutListPrefix = withoutQuotePrefix.replace(/^\s{0,3}([*+-]|\d+\.)\s+/gm, '')
  const withoutHeadings = withoutListPrefix.replace(/^\s{0,3}#{1,6}\s+/gm, '')
  return withoutHeadings.replace(/\s+/g, ' ').trim()
}

interface MessageContentProps {
  message: ChatMessage
  isTyping: boolean
  themeMode: 'light' | 'dark'
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
  retryContentForAi?: string
  conversationKey?: string
  isConversationStarred?: boolean
  onOpenRenameConversation?: () => void
  onToggleStarConversation?: (key: string) => void
  isTyping: boolean
  ttsSupported: boolean
  isSpeaking: boolean
  isTtsLoading: boolean
  onToggleSpeech: (message: ChatMessage) => void
  feedbackValue: 'like' | 'dislike' | 'default'
  onFeedbackChange: (value: 'like' | 'dislike' | 'default') => void
}

const MessageActions = memo(
  ({
    message,
    copiedMessageKey,
    onCopyMessage,
    onRetryMessage,
    retryContentForAi,
    conversationKey,
    isConversationStarred,
    onOpenRenameConversation,
    onToggleStarConversation,
    isTyping,
    ttsSupported,
    isSpeaking,
    isTtsLoading,
    onToggleSpeech,
    feedbackValue,
    onFeedbackChange,
    onPromptClick
  }: MessageActionsProps & { onPromptClick?: (question: string) => void }) => {
    const { token } = antdTheme.useToken()
    const isUserMessage = message.role === 'user'
    const isAiMessage = message.role === 'ai'
    const timeStr = formatTimestamp(message.timestamp)

    const hasSuggestions =
      message.role === 'ai' && message.suggestedQuestions && message.suggestedQuestions.length > 0

    const canRetryAi = !!retryContentForAi && !isTyping && !message.typing
    const canOperateConversation = !!conversationKey

    return (
      <div
        className={`message-actions flex flex-col gap-2 mt-1 ${isUserMessage ? 'items-end' : ''}`}
      >
        <div className={`flex items-center gap-2 ${isUserMessage ? 'justify-end' : ''}`}>
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
          <Actions
            variant="borderless"
            fadeInLeft
            items={
              isAiMessage
                ? [
                    {
                      key: 'audio',
                      actionRender: (
                        <Tooltip
                          title={
                            ttsSupported
                              ? isTtsLoading
                                ? '生成语音中...'
                                : isSpeaking
                                  ? '停止朗读'
                                  : '朗读'
                              : '当前环境不支持语音'
                          }
                        >
                          <Actions.Item
                            defaultIcon={<SoundOutlined />}
                            runningIcon={<StopOutlined />}
                            status={
                              !ttsSupported
                                ? 'default'
                                : isTtsLoading
                                  ? 'loading'
                                  : isSpeaking
                                    ? 'running'
                                    : 'default'
                            }
                            label="朗读"
                            onClick={() => onToggleSpeech(message)}
                            style={{
                              opacity:
                                !ttsSupported || isTyping || message.typing || isTtsLoading
                                  ? 0.5
                                  : 1,
                              pointerEvents:
                                !ttsSupported || isTyping || message.typing || isTtsLoading
                                  ? 'none'
                                  : 'auto'
                            }}
                          />
                        </Tooltip>
                      )
                    },
                    {
                      key: 'copy',
                      actionRender: <Actions.Copy text={message.content} />
                    },
                    ...(canOperateConversation
                      ? [
                          {
                            key: 'renameConversation',
                            actionRender: (
                              <Actions.Item
                                defaultIcon={<EditOutlined />}
                                label="重命名"
                                onClick={() => onOpenRenameConversation?.()}
                              />
                            )
                          },
                          {
                            key: 'starConversation',
                            actionRender: (
                              <Actions.Item
                                defaultIcon={
                                  isConversationStarred ? <StarFilled /> : <StarOutlined />
                                }
                                label={isConversationStarred ? '取消收藏' : '收藏'}
                                onClick={() => {
                                  if (!conversationKey) return
                                  onToggleStarConversation?.(conversationKey)
                                }}
                              />
                            )
                          }
                        ]
                      : []),
                    {
                      key: 'retry',
                      icon: <ReloadOutlined />,
                      label: '重试',
                      onItemClick: () => {
                        if (!canRetryAi || !retryContentForAi) return
                        onRetryMessage(retryContentForAi)
                      }
                    },
                    {
                      key: 'feedback',
                      actionRender: (
                        <Actions.Feedback value={feedbackValue} onChange={onFeedbackChange} />
                      )
                    }
                  ]
                : [
                    {
                      key: 'copy',
                      icon:
                        copiedMessageKey === message.key ? (
                          <CheckOutlined style={{ color: token.colorSuccess }} />
                        ) : (
                          <CopyOutlined />
                        ),
                      label: copiedMessageKey === message.key ? '已复制' : '复制',
                      onItemClick: () => onCopyMessage(message.content, message.key)
                    },
                    {
                      key: 'retry',
                      icon: <ReloadOutlined />,
                      label: '重新发送',
                      onItemClick: () => onRetryMessage(message.content),
                      danger: false
                    }
                  ]
            }
          />
        </div>

        {/* 智能建议 (Prompts) */}
        {hasSuggestions && (
          <div className="mt-2 w-full">
            <Prompts
              items={message.suggestedQuestions!.map((q) => ({
                key: q,
                label: q,
                icon: <BulbOutlined />
              }))}
              onItemClick={(info) => onPromptClick?.(info.data.label as string)}
              styles={{
                list: {
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  width: '100%'
                },
                item: {
                  background: token.colorFillQuaternary,
                  border: `1px solid ${token.colorBorderSecondary}`,
                  borderRadius: 16,
                  padding: '8px 16px',
                  fontSize: 13,
                  width: 'fit-content',
                  cursor: 'pointer',
                  transition: 'all 0.2s'
                }
              }}
            />
          </div>
        )}
      </div>
    )
  }
)

MessageActions.displayName = 'MessageActions'

const MessageContent = memo(
  ({ message, themeMode }: MessageContentProps) => {
    const { think, realContent } = useMemo(() => parseContent(message.content), [message.content])
    const hasContent = realContent.trim().length > 0
    const isThinking = message.typing && !hasContent && !!think
    const [expanded, setExpanded] = useState(false)
    const MAX_MD_CHARS = 3000
    const markdownThemeClass = themeMode === 'dark' ? 'x-markdown-dark' : 'x-markdown-light'

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
          content: <XMarkdown className={markdownThemeClass} content={think} />,
          status: isThinking ? ('loading' as const) : ('success' as const)
        }
      ]
    }, [think, isThinking, markdownThemeClass, message.typing])

    return (
      <div className="flex flex-col gap-3">
        {think && thoughtItems.length > 0 && <ThoughtChain items={thoughtItems} />}
        {hasContent ? (
          <div className="markdown-content">
            <XMarkdown
              className={markdownThemeClass}
              content={
                expanded || realContent.length <= MAX_MD_CHARS
                  ? realContent
                  : realContent.slice(0, MAX_MD_CHARS)
              }
            />
            {!expanded && realContent.length > MAX_MD_CHARS && (
              <div className="mt-2">
                <Button size="small" onClick={() => setExpanded(true)}>
                  展开完整内容
                </Button>
              </div>
            )}
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
      prev.isTyping === next.isTyping &&
      prev.themeMode === next.themeMode
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
  conversationKey,
  conversationLabel,
  isConversationStarred,
  onRenameConversation,
  onToggleStarConversation,
  onPromptClick
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
  const [speakingMessageKey, setSpeakingMessageKey] = useState<string | null>(null)
  const [ttsLoadingMessageKey, setTtsLoadingMessageKey] = useState<string | null>(null)
  const [feedbackByKey, setFeedbackByKey] = useState<
    Record<string, 'like' | 'dislike' | 'default'>
  >({})
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renameLoading, setRenameLoading] = useState(false)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const ttsSupported = useMemo(() => {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      typeof window.speechSynthesis?.speak === 'function' &&
      typeof window.speechSynthesis?.cancel === 'function' &&
      typeof (window as unknown as { SpeechSynthesisUtterance?: unknown })
        .SpeechSynthesisUtterance === 'function'
    )
  }, [])

  const stopSpeech = useCallback((): void => {
    if (ttsSupported) {
      window.speechSynthesis.cancel()
    }
    utteranceRef.current = null
    setSpeakingMessageKey(null)
    setTtsLoadingMessageKey(null)
  }, [ttsSupported])

  const speak = useCallback(
    async (message: ChatMessage): Promise<void> => {
      if (!ttsSupported) return

      const { realContent } = parseContent(message.content)
      const text = toSpeechText(realContent)
      if (!text) return

      stopSpeech()
      setTtsLoadingMessageKey(null)
      setSpeakingMessageKey(message.key)
      const utterance = new SpeechSynthesisUtterance(text)
      utterance.lang = 'zh-CN'
      utterance.rate = 1
      utterance.pitch = 1
      utterance.volume = 1
      utterance.onend = () => stopSpeech()
      utterance.onerror = () => stopSpeech()
      utteranceRef.current = utterance
      window.speechSynthesis.speak(utterance)
    },
    [stopSpeech, ttsSupported]
  )

  const toggleSpeech = useCallback(
    (message: ChatMessage): void => {
      if (!ttsSupported) return
      if (speakingMessageKey === message.key) {
        stopSpeech()
        return
      }
      stopSpeech()
      void speak(message)
    },
    [ttsSupported, speakingMessageKey, speak, stopSpeech]
  )

  const openRenameConversation = useCallback(() => {
    if (!conversationKey) return
    setRenameValue(conversationLabel ?? '')
    setRenameOpen(true)
  }, [conversationKey, conversationLabel])

  const handleRenameOk = useCallback(async () => {
    if (!conversationKey || !onRenameConversation) return
    const next = renameValue.trim()
    if (!next) return
    setRenameLoading(true)
    try {
      await onRenameConversation(conversationKey, next)
      setRenameOpen(false)
    } finally {
      setRenameLoading(false)
    }
  }, [conversationKey, onRenameConversation, renameValue])

  useEffect(() => {
    const t = setTimeout(() => {
      stopSpeech()
    }, 0)
    return () => clearTimeout(t)
  }, [conversationKey, stopSpeech])

  useEffect(() => {
    return () => {
      stopSpeech()
    }
  }, [stopSpeech])

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

  // 计算是否有被截断的消息
  const hasHiddenMessages = useMemo(() => {
    const filteredCount = currentMessages.filter(
      (m) => m.role !== 'system' || m.content.trim().length > 0
    ).length
    return filteredCount > MAX_RENDERED_MESSAGES
  }, [currentMessages])

  const EST_ITEM_HEIGHT = 140
  const VIRTUAL_THRESHOLD = 200
  const OVERSCAN = 10
  const [visibleRange, setVisibleRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: 0
  })
  const heightMapRef = useRef<Map<string, number>>(new Map())
  const [heightMapSnapshot, setHeightMapSnapshot] = useState<Map<string, number>>(new Map())
  const activeElementsRef = useRef<Map<string, HTMLElement>>(new Map())
  const elementToKeyRef = useRef<WeakMap<HTMLElement, string>>(new WeakMap())
  const observerRef = useRef<ResizeObserver | null>(null)
  const MAX_HEIGHT_CACHE = 2000

  useEffect(() => {
    observerRef.current = new ResizeObserver((entries) => {
      let needsUpdate = false
      for (const entry of entries) {
        const target = entry.target as HTMLElement
        const key = elementToKeyRef.current.get(target)
        if (key) {
          const h = target.offsetHeight
          if (h > 0 && h !== heightMapRef.current.get(key)) {
            heightMapRef.current.set(key, h)
            // Cache eviction using Map order (FIFO)
            if (heightMapRef.current.size > MAX_HEIGHT_CACHE) {
              const firstKey = heightMapRef.current.keys().next().value
              if (firstKey) {
                heightMapRef.current.delete(firstKey)
              }
            }
            needsUpdate = true
          }
        }
      }
      if (needsUpdate) {
        setVisibleRange((prev) => ({ ...prev }))
        setHeightMapSnapshot(new Map(heightMapRef.current))
      }
    })

    return () => {
      observerRef.current?.disconnect()
    }
  }, [])

  const setItemHeight = useCallback((key: string, el: HTMLElement | null) => {
    if (el) {
      const oldEl = activeElementsRef.current.get(key)
      if (oldEl && oldEl !== el) {
        observerRef.current?.unobserve(oldEl)
      }

      activeElementsRef.current.set(key, el)
      elementToKeyRef.current.set(el, key)
      observerRef.current?.observe(el)

      const h = el.offsetHeight
      if (h > 0 && h !== heightMapRef.current.get(key)) {
        heightMapRef.current.set(key, h)
        if (heightMapRef.current.size > MAX_HEIGHT_CACHE) {
          const firstKey = heightMapRef.current.keys().next().value
          if (firstKey) {
            heightMapRef.current.delete(firstKey)
          }
        }
      }
    } else {
      const oldEl = activeElementsRef.current.get(key)
      if (oldEl) {
        observerRef.current?.unobserve(oldEl)
        activeElementsRef.current.delete(key)
      }
    }
  }, [])

  const calculateCumulativeHeights = (keys: string[], map: Map<string, number>): number[] => {
    const cum: number[] = new Array(keys.length + 1)
    cum[0] = 0
    for (let i = 0; i < keys.length; i++) {
      const h = map.get(keys[i]) || EST_ITEM_HEIGHT
      cum[i + 1] = cum[i] + h
    }
    return cum
  }

  const computeCumulative = useCallback((keys: string[]): number[] => {
    return calculateCumulativeHeights(keys, heightMapRef.current)
  }, [])

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onScroll = (): void => {
      const filteredCount = currentMessages.filter(
        (m) => m.role !== 'system' || m.content.trim().length > 0
      ).length
      if (filteredCount < VIRTUAL_THRESHOLD) return
      const { scrollTop, clientHeight } = container
      const filteredKeys = currentMessages
        .filter((m) => m.role !== 'system' || m.content.trim().length > 0)
        .map((m) => m.key)
      const cum = computeCumulative(filteredKeys)
      const findIndex = (pos: number): number => {
        let lo = 0,
          hi = filteredKeys.length
        while (lo < hi) {
          const mid = (lo + hi) >> 1
          if (cum[mid] <= pos) lo = mid + 1
          else hi = mid
        }
        return Math.max(0, lo - 1)
      }
      const start = Math.max(0, findIndex(scrollTop) - OVERSCAN)
      const end = Math.min(filteredKeys.length, findIndex(scrollTop + clientHeight) + OVERSCAN)
      setVisibleRange({ start, end })
    }
    onScroll()
    container.addEventListener('scroll', onScroll, { passive: true })
    return () => container.removeEventListener('scroll', onScroll)
  }, [currentMessages, computeCumulative])

  const filteredMessagesForRender = useMemo(() => {
    const filtered = currentMessages.filter(
      (m) => m.role !== 'system' || m.content.trim().length > 0
    )
    if (filtered.length > VIRTUAL_THRESHOLD) {
      const start = visibleRange.start
      const end = visibleRange.end || Math.min(filtered.length, start + MAX_RENDERED_MESSAGES)
      const slice = filtered.slice(start, end)
      return slice
    }
    const fin =
      filtered.length > MAX_RENDERED_MESSAGES ? filtered.slice(-MAX_RENDERED_MESSAGES) : filtered
    return fin
  }, [currentMessages, visibleRange])

  const spacerHeights = useMemo(() => {
    const filtered = currentMessages.filter(
      (m) => m.role !== 'system' || m.content.trim().length > 0
    )
    if (filtered.length <= VIRTUAL_THRESHOLD) {
      return { top: 0, bottom: 0 }
    }

    const keys = filtered.map((m) => m.key)
    const cum = calculateCumulativeHeights(keys, heightMapSnapshot)
    const top = cum[visibleRange.start] || 0
    const endIndex =
      visibleRange.end ?? Math.min(filtered.length, visibleRange.start + MAX_RENDERED_MESSAGES)
    const total = cum[cum.length - 1] || 0
    const used = cum[endIndex] || 0
    const bottom = Math.max(0, total - used)

    return { top, bottom }
  }, [currentMessages, visibleRange, heightMapSnapshot])

  const bubbleItems = useMemo(() => {
    const messagesToRender = filteredMessagesForRender
    return messagesToRender.map((message) => {
      let retryContentForAi: string | undefined
      if (message.role === 'ai') {
        const idx = messagesToRender.findIndex((m) => m.key === message.key)
        if (idx > 0) {
          for (let i = idx - 1; i >= 0; i -= 1) {
            const m = messagesToRender[i]
            if (m.role === 'user' && m.content.trim()) {
              retryContentForAi = m.content
              break
            }
          }
        }
      }
      const { think, realContent } = parseContent(message.content)
      const hasContent = realContent.trim().length > 0
      const typing = message.typing && hasContent
      const loading = message.typing && !hasContent && !think
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
            retryContentForAi={retryContentForAi}
            conversationKey={conversationKey}
            isConversationStarred={isConversationStarred}
            onOpenRenameConversation={openRenameConversation}
            onToggleStarConversation={onToggleStarConversation}
            isTyping={isTyping}
            ttsSupported={ttsSupported}
            isSpeaking={speakingMessageKey === message.key}
            isTtsLoading={ttsLoadingMessageKey === message.key}
            onToggleSpeech={toggleSpeech}
            feedbackValue={feedbackByKey[message.key] || 'default'}
            onFeedbackChange={(value) =>
              setFeedbackByKey((prev) => ({ ...prev, [message.key]: value }))
            }
            onPromptClick={onPromptClick}
          />
        </div>
      )
      return {
        key: message.key,
        role: message.role,
        content: (
          <div ref={(el) => setItemHeight(message.key, el)}>
            <MessageContent message={message} isTyping={isTyping} themeMode={themeMode} />
          </div>
        ),
        typing,
        loading,
        footer
      }
    })
  }, [
    filteredMessagesForRender,
    isTyping,
    themeMode,
    copiedMessageKey,
    onCopyMessage,
    onRetryMessage,
    conversationKey,
    isConversationStarred,
    openRenameConversation,
    onToggleStarConversation,
    setItemHeight,
    ttsSupported,
    speakingMessageKey,
    ttsLoadingMessageKey,
    toggleSpeech,
    onPromptClick,
    feedbackByKey
  ])

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
        {spacerHeights.top > 0 && <div style={{ height: spacerHeights.top }} />}
        <Bubble.List ref={bubbleListRef} role={roles} autoScroll={false} items={bubbleItems} />
        {spacerHeights.bottom > 0 && <div style={{ height: spacerHeights.bottom }} />}
      </div>
      {showScrollToBottom && (
        <FloatButton
          type="primary"
          onClick={scrollToBottom}
          tooltip="回到底部"
          style={{ position: 'fixed', right: 24, bottom: 168 }}
        />
      )}
      <MetricsButton />
      <Modal
        title="重命名对话"
        open={renameOpen}
        onOk={() => void handleRenameOk()}
        okButtonProps={{ loading: renameLoading, disabled: !renameValue.trim() }}
        onCancel={() => {
          if (renameLoading) return
          setRenameOpen(false)
        }}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={() => void handleRenameOk()}
          placeholder="请输入对话名称"
          maxLength={50}
        />
      </Modal>
    </div>
  )
}

function MetricsButton(): ReactElement {
  const [open, setOpen] = useState(false)
  return (
    <>
      <FloatButton
        icon={<BarChartOutlined />}
        onClick={() => setOpen(true)}
        tooltip="指标"
        style={{ position: 'fixed', right: 24, bottom: 224 }}
      />
      <MetricsPanel open={open} onClose={() => setOpen(false)} />
    </>
  )
}

interface MetricsPanelProps {
  open: boolean
  onClose: () => void
}

function MetricsPanel({ open, onClose }: MetricsPanelProps): ReactElement {
  const [items, setItems] = useState<
    Array<{
      message: string
      timestamp: number
      context?: string
      metadata?: Record<string, unknown>
    }>
  >([])
  const [loading, setLoading] = useState(false)
  const load = useCallback(async () => {
    if (!window.api) return
    setLoading(true)
    try {
      const res = await window.api.getMetricsRecent?.(200)
      const list = Array.isArray(res) ? res : []
      setItems(list.filter((e) => e?.context === 'Search' || e?.context === 'LangGraph'))
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    if (open) {
      load()
    }
  }, [open, load])
  const summary = useMemoReact(() => {
    const searchMetrics = items.filter((i) => i.message === 'Search metrics')
    const searchCompleted = items.filter((i) => i.message === 'Search completed')
    const avgScores = searchMetrics
      .map((i) => Number(i.metadata?.['avgTopScore'] ?? 0))
      .filter((n) => !Number.isNaN(n))
    const meanAvg = avgScores.length ? avgScores.reduce((a, b) => a + b, 0) / avgScores.length : 0
    const latencies = searchCompleted
      .map((i) => Number(i.metadata?.['latencyMs'] ?? 0))
      .filter((n) => !Number.isNaN(n))
    const meanLatency = latencies.length
      ? latencies.reduce((a, b) => a + b, 0) / latencies.length
      : 0
    const coverage = new Set<string>()
    for (const c of searchCompleted) {
      const sources = c.metadata?.['sources']
      if (Array.isArray(sources)) {
        for (const s of sources) {
          if (s) coverage.add(String(s))
        }
      }
    }
    const langSteps = items.filter(
      (i) =>
        i.context === 'LangGraph' &&
        i.message === 'LangGraph step' &&
        i.metadata?.['phase'] === 'end'
    )
    const stepLatencies = langSteps
      .map((i) => Number(i.metadata?.['ms'] ?? 0))
      .filter((n) => !Number.isNaN(n) && n > 0)
    const stepMeanLatency = stepLatencies.length
      ? stepLatencies.reduce((a, b) => a + b, 0) / stepLatencies.length
      : 0
    return {
      meanAvg: Number(meanAvg.toFixed(3)),
      meanLatency: Math.round(meanLatency),
      coverageCount: coverage.size,
      stepCount: langSteps.length,
      stepMeanLatency: Math.round(stepMeanLatency)
    }
  }, [items])
  return (
    <Drawer
      title="指标"
      placement="right"
      onClose={onClose}
      open={open}
      styles={{ wrapper: { width: 420 } }}
    >
      <div className="mb-4 flex gap-4">
        <Tag color="blue">Top-K均值: {summary.meanAvg}</Tag>
        <Tag color="green">平均延迟: {summary.meanLatency}ms</Tag>
        <Tag color="purple">来源覆盖: {summary.coverageCount}</Tag>
        <Tag color="orange">步骤: {summary.stepCount}</Tag>
        <Tag color="geekblue">步骤均耗: {summary.stepMeanLatency}ms</Tag>
        <Button size="small" loading={loading} onClick={load}>
          刷新
        </Button>
      </div>
      <List
        size="small"
        bordered
        dataSource={items.slice().reverse().slice(0, 50)}
        renderItem={(item) => (
          <List.Item>
            <div className="flex flex-col w-full">
              <div className="flex justify-between">
                <span>{item.message}</span>
                <span>{new Date(item.timestamp).toLocaleTimeString('zh-CN')}</span>
              </div>
              {item.metadata && (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
                  {JSON.stringify(item.metadata, null, 2)}
                </pre>
              )}
            </div>
          </List.Item>
        )}
      />
    </Drawer>
  )
}
