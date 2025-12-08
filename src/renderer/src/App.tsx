import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Bubble,
  type BubbleItemType,
  Conversations,
  type ConversationsProps,
  Prompts,
  Sender,
  Sources,
  XProvider
} from '@ant-design/x'
import XMarkdown from '@ant-design/x-markdown'
import type { BubbleListRef } from '@ant-design/x/es/bubble'
import type { RoleType } from '@ant-design/x/es/bubble/interface'
import {
  Avatar,
  Button,
  Flex,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Tooltip,
  Typography,
  theme as antdTheme,
  message as antdMessage,
  Divider,
  Badge,
  FloatButton
} from 'antd'
import {
  SettingOutlined,
  DeleteOutlined,
  MoonFilled,
  SunFilled,
  PlusOutlined,
  FileTextOutlined,
  RobotOutlined,
  CopyOutlined,
  ReloadOutlined,
  UserOutlined,
  BulbOutlined,
  ThunderboltOutlined,
  SearchOutlined,
  StopOutlined,
  CheckOutlined,
  MessageOutlined,
  DatabaseOutlined,
  QuestionCircleOutlined,
  StarOutlined,
  EditOutlined
} from '@ant-design/icons'
import { getTheme } from './theme'
import { SettingsDialog, type AppSettings } from './components/SettingsDialog'
import { AppSidebar } from './components/AppSidebar'
import type {
  DocumentCollection,
  IndexedFile,
  IndexedFileRecord,
  KnowledgeBaseSnapshot
} from './types/files'

interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
}

type QuestionScope = 'all' | 'active' | 'collection'

interface ChatMessage {
  key: string
  role: 'user' | 'ai' | 'system'
  content: string
  sources?: ChatSource[]
  typing?: boolean
  timestamp?: number
  status?: 'success' | 'error' | 'pending'
}

interface Conversation {
  key: string
  label: string
  timestamp: number
  messages: ChatMessage[]
  icon?: ReactElement
}

const INITIAL_MESSAGE: ChatMessage = {
  key: 'system_welcome',
  role: 'system',
  content: '',
  timestamp: Date.now()
}

// 对话持久化存储键名
const CONVERSATIONS_STORAGE_KEY = 'rag_conversations'
const ACTIVE_CONVERSATION_KEY = 'rag_active_conversation'

// 可序列化的对话类型（不包含 ReactElement）
interface SerializableConversation {
  key: string
  label: string
  timestamp: number
  messages: ChatMessage[]
}

// 保存对话到 localStorage
function saveConversationsToStorage(conversations: Conversation[]): void {
  try {
    const serializable: SerializableConversation[] = conversations.map((conv) => ({
      key: conv.key,
      label: conv.label,
      timestamp: conv.timestamp,
      messages: conv.messages
    }))
    localStorage.setItem(CONVERSATIONS_STORAGE_KEY, JSON.stringify(serializable))
  } catch (error) {
    console.error('Failed to save conversations to storage:', error)
  }
}

// 从 localStorage 加载对话
function loadConversationsFromStorage(): Conversation[] {
  try {
    const stored = localStorage.getItem(CONVERSATIONS_STORAGE_KEY)
    if (!stored) return []
    
    const serializable: SerializableConversation[] = JSON.parse(stored)
    return serializable.map((conv) => ({
      ...conv,
      icon: <MessageOutlined />
    }))
  } catch (error) {
    console.error('Failed to load conversations from storage:', error)
    return []
  }
}

// 保存当前激活的对话键
function saveActiveConversationKey(key: string | undefined): void {
  try {
    if (key) {
      localStorage.setItem(ACTIVE_CONVERSATION_KEY, key)
    } else {
      localStorage.removeItem(ACTIVE_CONVERSATION_KEY)
    }
  } catch (error) {
    console.error('Failed to save active conversation key:', error)
  }
}

// 加载当前激活的对话键
function loadActiveConversationKey(): string | undefined {
  try {
    return localStorage.getItem(ACTIVE_CONVERSATION_KEY) || undefined
  } catch (error) {
    console.error('Failed to load active conversation key:', error)
    return undefined
  }
}

// 欢迎页面提示词配置
const WELCOME_PROMPTS = [
  {
    key: 'summary',
    icon: <FileTextOutlined style={{ fontSize: 20 }} />,
    label: '📋 智能总结',
    description: '快速提取文档核心观点和关键信息'
  },
  {
    key: 'qa',
    icon: <QuestionCircleOutlined style={{ fontSize: 20 }} />,
    label: '❓ 精准问答',
    description: '基于知识库内容回答您的问题'
  },
  {
    key: 'analysis',
    icon: <BulbOutlined style={{ fontSize: 20 }} />,
    label: '💡 深度分析',
    description: '对文档内容进行深入分析和洞察'
  },
  {
    key: 'extract',
    icon: <SearchOutlined style={{ fontSize: 20 }} />,
    label: '🔍 信息提取',
    description: '从文档中提取特定类型的信息'
  }
]

// 快速提问模板
const QUICK_QUESTIONS = [
  '总结这篇文档的主要内容',
  '这个文档讨论了哪些关键问题？',
  '帮我列出文档中的重要数据',
  '这个文档的结论是什么？'
]

function App(): ReactElement {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(prefersDark ? 'dark' : 'light')

  const providerTheme = useMemo(() => getTheme(themeMode), [themeMode])

  // 监听系统主题变化
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    const handleChange = (e: MediaQueryListEvent): void => {
      setThemeMode(e.matches ? 'dark' : 'light')
    }
    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [])

  // 同步 body class 用于 CSS 选择器
  useEffect(() => {
    document.body.classList.toggle('dark', themeMode === 'dark')
  }, [themeMode])

  return (
    <XProvider theme={providerTheme}>
      <AppContent themeMode={themeMode} onThemeChange={setThemeMode} />
    </XProvider>
  )
}

interface AppContentProps {
  themeMode: 'light' | 'dark'
  onThemeChange: (mode: 'light' | 'dark') => void
}

function AppContent({ themeMode, onThemeChange }: AppContentProps): ReactElement {
  const [messageApi, contextHolder] = antdMessage.useMessage()
  const { token } = antdTheme.useToken()
  const [inputValue, setInputValue] = useState('')

  // 对话管理
  const [conversations, setConversations] = useState<Conversation[]>([])
  const [activeConversationKey, setActiveConversationKey] = useState<string | undefined>()

  // 包装 setActiveConversationKey 以自动保存
  const handleActiveConversationChange = useCallback((key: string | undefined) => {
    setActiveConversationKey(key)
    saveActiveConversationKey(key)
  }, [])

  const [files, setFiles] = useState<IndexedFile[]>([])
  const [collections, setCollections] = useState<DocumentCollection[]>([])
  const [activeDocument, setActiveDocument] = useState<string | undefined>(undefined)
  const [activeCollectionId, setActiveCollectionId] = useState<string | undefined>(undefined)
  const [isTyping, setIsTyping] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [, setCurrentSettings] = useState<AppSettings | null>(null)
  const [questionScope, setQuestionScope] = useState<QuestionScope>('all')
  const [collectionModalOpen, setCollectionModalOpen] = useState(false)
  const [editingCollection, setEditingCollection] = useState<DocumentCollection | null>(null)
  const [collectionForm] = Form.useForm()

  // 新增状态
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null)
  const [sidebarCollapsed] = useState(false)

  // 当前对话的消息
  const currentMessages = useMemo(() => {
    const conv = conversations.find((c) => c.key === activeConversationKey)
    return conv?.messages ?? [INITIAL_MESSAGE]
  }, [conversations, activeConversationKey])

  const updateActiveDocument = useCallback(
    (path?: string) => {
      setActiveDocument(path)
      if (!path && questionScope === 'active') {
        setQuestionScope('all')
      }
    },
    [questionScope]
  )

  const bubbleListRef = useRef<BubbleListRef | null>(null)
  const streamMessageKeyRef = useRef<string | null>(null)
  const pendingSourcesRef = useRef<ChatSource[]>([])
  const idCounterRef = useRef(0)

  const syncKnowledgeBase = useCallback(
    (snapshot: KnowledgeBaseSnapshot) => {
      setFiles((prev) => mergeRecordsWithTransient(snapshot.files, prev))
      setCollections(snapshot.collections)

      setActiveCollectionId((currentActiveCollectionId) => {
        if (snapshot.collections.length === 0) {
          setActiveDocument(undefined)
          return undefined
        }

        if (
          currentActiveCollectionId &&
          !snapshot.collections.some((collection) => collection.id === currentActiveCollectionId)
        ) {
          const fallbackCollection = snapshot.collections[0]
          setActiveDocument(fallbackCollection?.files[0])
          return fallbackCollection?.id
        }

        if (currentActiveCollectionId) {
          const currentCollection = snapshot.collections.find(
            (collection) => collection.id === currentActiveCollectionId
          )
          if (currentCollection) {
            setActiveDocument((currentActiveDocument) => {
              if (currentCollection.files.length === 0) {
                return undefined
              }
              if (
                currentActiveDocument &&
                !currentCollection.files.includes(currentActiveDocument)
              ) {
                return currentCollection.files[0]
              }
              return currentActiveDocument
            })
          }
        }
        return currentActiveCollectionId
      })

      if (snapshot.collections.length === 0 && questionScope === 'collection') {
        setQuestionScope('all')
      }
    },
    [questionScope]
  )

  const readyDocuments = useMemo(
    () => files.filter((file) => file.status === 'ready').length,
    [files]
  )

  const activeFile = useMemo(
    () => files.find((file) => file.path === activeDocument),
    [files, activeDocument]
  )

  const createMessageKey = useCallback((prefix: string): string => {
    idCounterRef.current += 1
    return `${prefix}-${idCounterRef.current}`
  }, [])

  // 创建新对话
  const createNewConversation = useCallback(() => {
    const newKey = `conv-${Date.now()}`
    const newConv: Conversation = {
      key: newKey,
      label: '新对话',
      timestamp: Date.now(),
      messages: [INITIAL_MESSAGE],
      icon: <MessageOutlined />
    }
    setConversations((prev) => {
      const updated = [newConv, ...prev]
      saveConversationsToStorage(updated)
      return updated
    })
    handleActiveConversationChange(newKey)
    setInputValue('')
  }, [handleActiveConversationChange])

  // 更新当前对话的消息
  const updateCurrentMessages = useCallback(
    (updater: (prev: ChatMessage[]) => ChatMessage[]) => {
      setConversations((prev) => {
        const updated = prev.map((conv) => {
          if (conv.key === activeConversationKey) {
            const newMessages = updater(conv.messages)
            // 更新对话标题（使用第一条用户消息）
            const firstUserMsg = newMessages.find((m) => m.role === 'user')
            const label = firstUserMsg
              ? firstUserMsg.content.slice(0, 20) + (firstUserMsg.content.length > 20 ? '...' : '')
              : '新对话'
            return { ...conv, messages: newMessages, label, timestamp: Date.now() }
          }
          return conv
        })
        saveConversationsToStorage(updated)
        return updated
      })
    },
    [activeConversationKey]
  )

  useEffect(() => {
    void (async () => {
      try {
        const [loadedSettings, snapshot] = await Promise.all([
          window.api.getSettings(),
          window.api.getKnowledgeBase()
        ])
        setCurrentSettings(loadedSettings)
        syncKnowledgeBase(snapshot)
        if (snapshot.files.length > 0) {
          updateActiveDocument(snapshot.files[0]?.path)
        }
        if (snapshot.collections.length > 0) {
          setActiveCollectionId((prev) => prev ?? snapshot.collections[0]?.id)
        }
        
        // 从 localStorage 加载对话
        const loadedConversations = loadConversationsFromStorage()
        const loadedActiveKey = loadActiveConversationKey()

        if (loadedConversations.length > 0) {
          setConversations(loadedConversations)
          // 验证激活的对话键是否存在
          const validKey =
            loadedActiveKey && loadedConversations.some((c) => c.key === loadedActiveKey)
              ? loadedActiveKey
              : loadedConversations[0]?.key
          handleActiveConversationChange(validKey)
        } else {
          // 只有在没有已保存对话时才创建新对话
          createNewConversation()
        }
      } catch (error) {
        console.error('Failed to initialize app:', error)
      }
    })()
  }, [
    syncKnowledgeBase,
    updateActiveDocument,
    createNewConversation,
    handleActiveConversationChange
  ])

  useEffect(() => {
    const handleToken = (tokenChunk: string): void => {
      updateCurrentMessages((prev) =>
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
        updateCurrentMessages((prev) =>
          prev.map((message) =>
            message.key === streamMessageKeyRef.current
              ? { ...message, typing: false, sources: pendingSourcesRef.current, status: 'success' }
              : message
          )
        )
      }
      pendingSourcesRef.current = []
      streamMessageKeyRef.current = null
      setIsTyping(false)
    }

    const handleError = (error: string): void => {
      updateCurrentMessages((prev) => {
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
            key: createMessageKey('error'),
            role: 'system' as const,
            content: `⚠️ 发生错误：${error}`,
            timestamp: Date.now(),
            status: 'error' as const
          }
        ]
      })
      pendingSourcesRef.current = []
      streamMessageKeyRef.current = null
      setIsTyping(false)
      messageApi.error('对话失败，请检查模型服务或日志信息')
    }

    window.api.onChatToken(handleToken)
    window.api.onChatSources(handleSources)
    window.api.onChatDone(handleDone)
    window.api.onChatError(handleError)

    return () => {
      window.api.removeAllChatListeners()
    }
  }, [createMessageKey, messageApi, updateCurrentMessages])

  const resolvedCollectionId = useMemo(() => {
    if (!collections.length) {
      return undefined
    }
    if (
      activeCollectionId &&
      collections.some((collection) => collection.id === activeCollectionId)
    ) {
      return activeCollectionId
    }
    return collections[0]?.id
  }, [activeCollectionId, collections])

  useEffect(() => {
    bubbleListRef.current?.scrollTo({ top: 'bottom', behavior: 'smooth' })
  }, [currentMessages])

  const handleUpload = async (targetCollectionId?: string): Promise<void> => {
    try {
      const filePath = await window.api.selectFile()
      if (!filePath) return

      if (files.some((file) => file.path === filePath)) {
        messageApi.info('该文件已经导入')
        return
      }

      const nextFile: IndexedFile = {
        path: filePath,
        name: extractFileName(filePath),
        status: 'processing',
        updatedAt: Date.now()
      }

      setFiles((prev) => [...prev, nextFile])
      updateActiveDocument(filePath)

      const result = await window.api.processFile(filePath)
      if (result.success) {
        setFiles((prev) =>
          prev.map((file) =>
            file.path === filePath
              ? {
                  ...file,
                  status: 'ready',
                  chunkCount: result.count,
                  preview: result.preview,
                  error: undefined,
                  updatedAt: Date.now()
                }
              : file
          )
        )

        if (targetCollectionId) {
          const targetCollection = collections.find(
            (collection) => collection.id === targetCollectionId
          )
          if (targetCollection && !targetCollection.files.includes(filePath)) {
            const snapshot = await window.api.updateCollection({
              id: targetCollectionId,
              files: [...targetCollection.files, filePath]
            })
            syncKnowledgeBase(snapshot)
          }
        }

        messageApi.success('文档索引完成')
      } else {
        setFiles((prev) =>
          prev.map((file) =>
            file.path === filePath
              ? {
                  ...file,
                  status: 'error',
                  error: result.error ?? '未知错误',
                  updatedAt: Date.now()
                }
              : file
          )
        )
        messageApi.error(result.error ?? '文档处理失败')
      }
    } catch (error) {
      console.error(error)
      messageApi.error('文档处理失败，请查看控制台日志')
    }
  }

  const handleSend = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || isTyping) return

    // 如果没有活动对话，创建一个新的
    if (!activeConversationKey) {
      createNewConversation()
    }

    let selectedSources: string[] | undefined

    if (questionScope === 'active') {
      if (!activeDocument) {
        messageApi.warning('请先选择一个文档')
        return
      }
      selectedSources = [activeDocument]
    } else if (questionScope === 'collection') {
      if (!resolvedCollectionId) {
        messageApi.warning('请先创建并选择一个文档集')
        return
      }
      const targetCollection = collections.find(
        (collection) => collection.id === resolvedCollectionId
      )
      if (!targetCollection) {
        messageApi.warning('请选择有效的文档集')
        return
      }
      if (targetCollection.files.length === 0) {
        messageApi.warning('当前文档集为空，请添加文档后重试')
        return
      }
      selectedSources = targetCollection.files
    }

    const userMessage: ChatMessage = {
      key: createMessageKey('user'),
      role: 'user',
      content: trimmed,
      timestamp: Date.now()
    }
    const aiMessageKey = createMessageKey('ai')
    const aiMessage: ChatMessage = {
      key: aiMessageKey,
      role: 'ai',
      content: '',
      typing: true,
      timestamp: Date.now(),
      status: 'pending'
    }

    updateCurrentMessages((prev) => [...prev, userMessage, aiMessage])
    setInputValue('')
    setIsTyping(true)
    streamMessageKeyRef.current = aiMessageKey
    pendingSourcesRef.current = []

    window.api.chat({ question: trimmed, sources: selectedSources })
  }

  const handlePromptClick = (content: string): void => {
    if (!content.trim()) return
    if (!isTyping) {
      handleSend(content)
    } else {
      setInputValue(content)
    }
  }

  // 复制消息内容
  const handleCopyMessage = useCallback(
    (content: string, key: string) => {
      navigator.clipboard.writeText(content).then(() => {
        setCopiedMessageKey(key)
        messageApi.success('已复制到剪贴板')
        setTimeout(() => setCopiedMessageKey(null), 2000)
      })
    },
    [messageApi]
  )

  // 重试消息
  const handleRetryMessage = useCallback(
    (content: string) => {
      if (!isTyping) {
        handleSend(content)
      }
    },
    [isTyping, handleSend]
  )

  // 停止生成
  const handleStopGeneration = useCallback(() => {
    // 这里可以调用 API 停止生成
    if (streamMessageKeyRef.current) {
      updateCurrentMessages((prev) =>
        prev.map((message) =>
          message.key === streamMessageKeyRef.current
            ? { ...message, typing: false, status: 'success' as const }
            : message
        )
      )
      streamMessageKeyRef.current = null
      setIsTyping(false)
      messageApi.info('已停止生成')
    }
  }, [updateCurrentMessages, messageApi])

  const collectionFileOptions = useMemo(
    () =>
      files
        .filter((file) => file.status === 'ready')
        .map((file) => ({
          label: file.name,
          value: file.path
        })),
    [files]
  )

  const handleCollectionModalClose = useCallback(() => {
    collectionForm.resetFields()
    setCollectionModalOpen(false)
  }, [collectionForm])

  const openCreateCollection = useCallback(() => {
    setEditingCollection(null)
    collectionForm.setFieldsValue({
      name: '',
      description: '',
      files: []
    })
    setCollectionModalOpen(true)
  }, [collectionForm])

  const openEditCollection = useCallback(
    (collection: DocumentCollection) => {
      setEditingCollection(collection)
      collectionForm.setFieldsValue({
        name: collection.name,
        description: collection.description ?? '',
        files: collection.files
      })
      setCollectionModalOpen(true)
    },
    [collectionForm]
  )

  const handleCollectionSubmit = useCallback(async () => {
    try {
      const values = await collectionForm.validateFields()
      const payload = {
        name: values.name as string,
        description: (values.description as string | undefined) ?? undefined,
        files: (values.files as string[]) ?? []
      }

      const snapshot = editingCollection
        ? await window.api.updateCollection({ id: editingCollection.id, ...payload })
        : await window.api.createCollection(payload)

      syncKnowledgeBase(snapshot)

      if (!editingCollection) {
        const createdId = snapshot.collections[snapshot.collections.length - 1]?.id
        if (createdId) {
          setActiveCollectionId(createdId)
          setQuestionScope('collection')
        }
      }

      messageApi.success(editingCollection ? '文档集已更新' : '文档集已创建')
      handleCollectionModalClose()
    } catch (error) {
      if (Array.isArray((error as { errorFields?: unknown[] }).errorFields)) {
        return
      }
      console.error('Failed to save collection:', error)
      messageApi.error('保存文档集失败，请查看日志')
    }
  }, [collectionForm, editingCollection, handleCollectionModalClose, messageApi, syncKnowledgeBase])

  const handleDeleteCollection = useCallback(
    async (collectionId: string) => {
      try {
        const snapshot = await window.api.deleteCollection(collectionId)
        syncKnowledgeBase(snapshot)
        messageApi.success('文档集已删除')
      } catch (error) {
        console.error('Failed to delete collection:', error)
        messageApi.error('删除文档集失败，请查看日志')
      }
    },
    [messageApi, syncKnowledgeBase]
  )

  const handleReindexDocument = useCallback(
    async (filePath: string) => {
      try {
        messageApi.loading({ content: '正在重新索引...', key: 'reindex' })
        const snapshot = await window.api.reindexIndexedFile(filePath)
        syncKnowledgeBase(snapshot)
        messageApi.success({ content: '重新索引完成', key: 'reindex' })
      } catch (error) {
        console.error('Failed to reindex document:', error)
        messageApi.error({ content: '重新索引失败，请查看日志', key: 'reindex' })
      }
    },
    [messageApi, syncKnowledgeBase]
  )

  const handleRemoveDocument = useCallback(
    async (filePath: string) => {
      try {
        const snapshot = await window.api.removeIndexedFile(filePath)
        syncKnowledgeBase(snapshot)
        if (activeDocument === filePath) {
          updateActiveDocument(undefined)
        }
        messageApi.success('文档已移除')
      } catch (error) {
        console.error('Failed to remove document:', error)
        messageApi.error('移除文档失败，请查看日志')
      }
    },
    [activeDocument, messageApi, syncKnowledgeBase, updateActiveDocument]
  )

  const handleDeleteConversation = useCallback(
    (key: string) => {
      setConversations((prev) => {
        const updated = prev.filter((c) => c.key !== key)
        saveConversationsToStorage(updated)
        return updated
      })
      if (activeConversationKey === key) {
        const remaining = conversations.filter((c) => c.key !== key)
        if (remaining.length > 0) {
          const newActiveKey = remaining[0].key
          handleActiveConversationChange(newActiveKey)
        } else {
          createNewConversation()
        }
      }
    },
    [activeConversationKey, conversations, createNewConversation, handleActiveConversationChange]
  )

  // 渲染消息操作按钮
  const renderMessageActions = useCallback(
    (message: ChatMessage) => {
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
              onClick={() => handleCopyMessage(message.content, message.key)}
            />
          </Tooltip>
          {message.role === 'user' && (
            <Tooltip title="重新发送">
              <Button
                type="text"
                size="small"
                icon={<ReloadOutlined />}
                onClick={() => handleRetryMessage(message.content)}
                disabled={isTyping}
              />
            </Tooltip>
          )}
        </div>
      )
    },
    [copiedMessageKey, token.colorSuccess, handleCopyMessage, handleRetryMessage, isTyping]
  )

  // 头像配置
  const userAvatar = (
    <Avatar
      size={36}
      icon={<UserOutlined />}
      style={{
        background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`
      }}
    />
  )

  const aiAvatar = (
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
  )

  const systemAvatar = (
    <Avatar
      size={36}
      icon={<BulbOutlined />}
      style={{
        background: token.colorWarningBg,
        color: token.colorWarning
      }}
    />
  )

  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      currentMessages
        .filter((m) => m.role !== 'system' || m.content.trim().length > 0)
        .map((message) => ({
          key: message.key,
          role: message.role,
          placement: message.role === 'user' ? ('end' as const) : ('start' as const),
          avatar:
            message.role === 'user' ? userAvatar : message.role === 'ai' ? aiAvatar : systemAvatar,
          content:
            message.content.trim().length > 0 ? (
              <div className="markdown-content">
                <XMarkdown>{message.content}</XMarkdown>
                {renderMessageActions(message)}
              </div>
            ) : message.typing ? (
              <div className="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
              </div>
            ) : (
              <span className="italic text-gray-400">……</span>
            ),
          typing: message.typing,
          loading: message.typing,
          extraInfo: { sources: message.sources, timestamp: message.timestamp }
        })),
    [currentMessages, renderMessageActions, token, themeMode, userAvatar, aiAvatar, systemAvatar]
  )

  const roles = useMemo<RoleType>(
    () => ({
      user: {
        placement: 'end',
        variant: 'shadow',
        avatar: (
          <Avatar
            size={36}
            icon={<UserOutlined />}
            style={{
              background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`
            }}
          />
        ),
        styles: {
          content: {
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
            color: '#fff',
            borderRadius: 16,
            padding: '12px 16px',
            maxWidth: '70%'
          }
        }
      },
      ai: {
        placement: 'start',
        variant: 'filled',
        avatar: (
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
        styles: {
          content: {
            background: themeMode === 'dark' ? token.colorBgElevated : token.colorBgContainer,
            border: `1px solid ${token.colorBorderSecondary}`,
            borderRadius: 16,
            padding: '12px 16px',
            maxWidth: '70%'
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
        avatar: (
          <Avatar
            size={36}
            icon={<BulbOutlined />}
            style={{
              background: token.colorWarningBg,
              color: token.colorWarning
            }}
          />
        ),
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
    [token, themeMode]
  )

  // Conversations 组件的菜单配置
  const conversationsMenuConfig: ConversationsProps['menu'] = useCallback(
    (conversation: { key: string }) => ({
      items: [
        {
          key: 'rename',
          label: '重命名',
          icon: <EditOutlined />
        },
        {
          key: 'star',
          label: '收藏',
          icon: <StarOutlined />
        },
        {
          type: 'divider' as const
        },
        {
          key: 'delete',
          label: '删除对话',
          icon: <DeleteOutlined />,
          danger: true
        }
      ],
      onClick: ({ key }: { key: string }) => {
        if (key === 'delete') {
          handleDeleteConversation(conversation.key)
        }
      }
    }),
    [handleDeleteConversation]
  )

  const showWelcome =
    currentMessages.length === 1 &&
    currentMessages[0].role === 'system' &&
    !currentMessages[0].content

  // 转换对话列表为 Conversations 组件需要的格式
  const conversationItems = useMemo(
    () =>
      conversations.map((conv) => ({
        key: conv.key,
        label: conv.label,
        icon: <MessageOutlined />,
        timestamp: conv.timestamp
      })),
    [conversations]
  )

  // Sender 头部操作
  const senderHeader = useMemo(
    () => (
      <div className="flex items-center gap-2 px-2 py-1">
        <Select
          size="small"
          value={questionScope}
          onChange={setQuestionScope}
          options={[
            { label: '🌐 全库检索', value: 'all' },
            { label: '📄 当前文档', value: 'active', disabled: !activeDocument },
            { label: '📁 文档集', value: 'collection', disabled: collections.length === 0 }
          ]}
          style={{ width: 130 }}
          variant="borderless"
        />
        {questionScope === 'collection' && (
          <Select
            size="small"
            placeholder="选择文档集"
            value={resolvedCollectionId}
            options={collections.map((collection) => ({
              label: `${collection.name} (${collection.files.length})`,
              value: collection.id
            }))}
            onChange={(value) => setActiveCollectionId(value)}
            style={{ width: 160 }}
            variant="borderless"
          />
        )}
        <div className="flex-1" />
        <Typography.Text type="secondary" className="text-xs">
          {questionScope === 'active'
            ? `限定: ${activeFile?.name || '未选择'}`
            : questionScope === 'collection'
              ? `限定: ${collections.find((c) => c.id === resolvedCollectionId)?.name || '未选择'}`
              : `全库 · ${readyDocuments} 个文档`}
        </Typography.Text>
      </div>
    ),
    [questionScope, activeDocument, collections, resolvedCollectionId, activeFile, readyDocuments]
  )

  return (
    <div className="flex h-screen overflow-hidden" style={{ background: token.colorBgLayout }}>
      {contextHolder}

      {/* 左侧：对话历史 */}
      <aside
        className={`glass-sidebar flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-72'}`}
        style={{
          background: token.colorBgContainer,
          borderRight: `1px solid ${token.colorBorderSecondary}`
        }}
      >
        {/* Logo 和新建对话 */}
        <div
          className="px-4 pt-5 pb-4"
          style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        >
          <Flex align="center" gap={12} className="mb-4">
            <div className="avatar-glow" style={{ borderRadius: 12 }}>
              <Avatar
                size={44}
                icon={<RobotOutlined style={{ fontSize: 24 }} />}
                style={{
                  background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
                  borderRadius: 12
                }}
              />
            </div>
            <div>
              <Typography.Title level={4} style={{ margin: 0, marginBottom: 2 }}>
                RAG 助手
              </Typography.Title>
              <Typography.Text type="secondary" className="text-xs">
                本地知识库问答
              </Typography.Text>
            </div>
          </Flex>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            className="mt-5 btn-hover-lift"
            block
            size="large"
            onClick={createNewConversation}
            style={{
              background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
              border: 'none',
              height: 44,
              borderRadius: 12
            }}
          >
            开始新对话
          </Button>
        </div>

        {/* 对话列表 */}
        <div className="flex-1 overflow-y-auto conversation-list">
          <div className="px-3 py-2">
            <Typography.Text
              type="secondary"
              className="text-xs font-medium uppercase tracking-wider"
            >
              对话历史
            </Typography.Text>
          </div>
          <Conversations
            items={conversationItems}
            activeKey={activeConversationKey}
            onActiveChange={handleActiveConversationChange}
            menu={conversationsMenuConfig}
            style={{ padding: '0 8px' }}
          />
        </div>

        {/* 底部操作 */}
        <div className="p-3" style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
          <Flex justify="space-between" align="center">
            <Space>
              <Tooltip title="模型设置">
                <Button
                  type="text"
                  icon={<SettingOutlined />}
                  onClick={() => setSettingsOpen(true)}
                />
              </Tooltip>
              <Tooltip title={themeMode === 'dark' ? '浅色模式' : '深色模式'}>
                <Button
                  type="text"
                  icon={
                    themeMode === 'dark' ? (
                      <SunFilled style={{ color: '#fbbf24' }} />
                    ) : (
                      <MoonFilled style={{ color: '#6366f1' }} />
                    )
                  }
                  onClick={() => onThemeChange(themeMode === 'dark' ? 'light' : 'dark')}
                />
              </Tooltip>
            </Space>
            <Badge
              count={readyDocuments}
              size="small"
              style={{ backgroundColor: token.colorSuccess }}
            >
              <Tooltip title="知识库文档数">
                <Button type="text" icon={<DatabaseOutlined />} />
              </Tooltip>
            </Badge>
          </Flex>
        </div>
      </aside>

      {/* 中间：聊天区域 */}
      <section className="flex min-w-0 flex-1 flex-col">
        {/* 聊天内容 */}
        <main className="flex flex-1 flex-col overflow-hidden">
          {showWelcome ? (
            <div className="welcome-container flex flex-1 flex-col items-center justify-center p-8 relative">
              <div className="relative z-10 max-w-2xl w-full">
                {/* 欢迎区域 */}
                <div className="text-center mb-10">
                  <div
                    className="inline-flex items-center justify-center w-20 h-20 mb-6 rounded-2xl avatar-glow"
                    style={{
                      background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`
                    }}
                  >
                    <RobotOutlined style={{ fontSize: 40, color: '#fff' }} />
                  </div>
                  <Typography.Title level={2} style={{ marginBottom: 8 }}>
                    <span className="gradient-text">你好，我是 RAG 智能助手</span>
                  </Typography.Title>
                  <Typography.Paragraph type="secondary" style={{ fontSize: 16, marginBottom: 0 }}>
                    基于本地知识库的智能问答系统，支持多文档检索与引用追溯
                  </Typography.Paragraph>
                </div>

                {/* 功能卡片 */}
                <div className="prompts-container mb-8">
                  <Typography.Text type="secondary" className="block text-center mb-4">
                    我可以帮你：
                  </Typography.Text>
                  <Prompts
                    items={WELCOME_PROMPTS}
                    onItemClick={({ data }) =>
                      handlePromptClick(String(data.description ?? data.label ?? ''))
                    }
                    wrap
                  />
                </div>

                {/* 快速开始提示 */}
                <div className="text-center">
                  <Typography.Text type="secondary" className="text-sm">
                    💡 提示：先在右侧导入文档，然后开始对话
                  </Typography.Text>
                </div>

                {/* 知识库状态 */}
                {readyDocuments > 0 && (
                  <div
                    className="mt-6 p-4 rounded-xl text-center"
                    style={{
                      background:
                        themeMode === 'dark'
                          ? 'rgba(129, 140, 248, 0.1)'
                          : 'rgba(79, 70, 229, 0.05)',
                      border: `1px solid ${themeMode === 'dark' ? 'rgba(129, 140, 248, 0.2)' : 'rgba(79, 70, 229, 0.1)'}`
                    }}
                  >
                    <Space>
                      <CheckOutlined style={{ color: token.colorSuccess }} />
                      <Typography.Text>
                        知识库已就绪，共 <strong>{readyDocuments}</strong> 个文档可供检索
                      </Typography.Text>
                    </Space>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div
              className="chat-bubble-list flex-1 overflow-y-auto p-6"
              style={{ background: token.colorBgLayout }}
            >
              <div className="max-w-4xl mx-auto">
                <Bubble.List
                  ref={(instance) => {
                    bubbleListRef.current = instance
                  }}
                  items={bubbleItems}
                  role={roles}
                  autoScroll
                />
              </div>
            </div>
          )}
        </main>

        {/* 输入区域 */}
        <footer
          className="chat-sender p-4"
          style={{
            background: token.colorBgContainer,
            borderTop: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          <div className="mx-auto max-w-4xl">
            {/* 快捷提问 */}
            {!isTyping && currentMessages.length <= 1 && (
              <div className="flex flex-wrap gap-2 mb-3">
                {QUICK_QUESTIONS.slice(0, 3).map((q, i) => (
                  <Tag
                    key={i}
                    className="cursor-pointer card-hover"
                    style={{
                      borderRadius: 20,
                      padding: '4px 12px',
                      background:
                        themeMode === 'dark'
                          ? 'rgba(129, 140, 248, 0.1)'
                          : 'rgba(79, 70, 229, 0.05)',
                      border: `1px solid ${themeMode === 'dark' ? 'rgba(129, 140, 248, 0.2)' : 'rgba(79, 70, 229, 0.1)'}`,
                      color: token.colorPrimary
                    }}
                    onClick={() => handlePromptClick(q)}
                  >
                    <ThunderboltOutlined className="mr-1" />
                    {q}
                  </Tag>
                ))}
              </div>
            )}

            {/* 检索范围选择 */}
            {senderHeader}

            <Divider style={{ margin: '8px 0' }} />

            {/* 输入框 */}
            <div className="relative">
              <Sender
                value={inputValue}
                onChange={(value) => setInputValue(value)}
                onSubmit={(value) => handleSend(value)}
                placeholder={
                  readyDocuments > 0
                    ? '输入您的问题，我将从知识库中为您找到答案...'
                    : '请先导入文档到知识库...'
                }
                loading={isTyping}
                submitType="enter"
              />
              {isTyping && (
                <Tooltip title="停止生成">
                  <Button
                    type="text"
                    danger
                    icon={<StopOutlined />}
                    onClick={handleStopGeneration}
                    className="absolute right-14 top-1/2 -translate-y-1/2"
                  />
                </Tooltip>
              )}
            </div>
          </div>
        </footer>
      </section>

      {/* 右侧：知识库面板 */}
      <AppSidebar
        collections={collections}
        activeCollectionId={activeCollectionId}
        activeDocument={activeDocument}
        files={files}
        onCollectionChange={(key) => setActiveCollectionId(key || undefined)}
        onCreateCollection={openCreateCollection}
        onEditCollection={openEditCollection}
        onDeleteCollection={(id) => void handleDeleteCollection(id)}
        onUpload={(targetCollectionId) => void handleUpload(targetCollectionId)}
        onUpdateActiveDocument={updateActiveDocument}
        onReindexDocument={handleReindexDocument}
        onRemoveDocument={handleRemoveDocument}
      />

      {/* 文档集编辑弹窗 */}
      <Modal
        title={
          <Space>
            {editingCollection ? <EditOutlined /> : <PlusOutlined />}
            {editingCollection ? '编辑文档集' : '新建文档集'}
          </Space>
        }
        open={collectionModalOpen}
        onCancel={handleCollectionModalClose}
        onOk={() => void handleCollectionSubmit()}
        okText={editingCollection ? '保存' : '创建'}
        cancelText="取消"
        destroyOnClose
        centered
        width={500}
      >
        <Form form={collectionForm} layout="vertical" className="mt-4">
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入文档集名称' }]}
          >
            <Input placeholder="例如：研报摘要" size="large" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea placeholder="补充说明该文档集的用途" rows={3} />
          </Form.Item>
          <Form.Item label="包含文档" name="files">
            <Select
              mode="multiple"
              placeholder="选择要加入的文档（可留空，后续再导入）"
              options={collectionFileOptions}
              optionFilterProp="label"
              size="large"
            />
          </Form.Item>
        </Form>
      </Modal>

      {/* 设置弹窗 */}
      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(saved) => {
          setCurrentSettings(saved)
          setSettingsOpen(false)
        }}
      />

      {/* 浮动按钮 - 回到顶部 */}
      <FloatButton.BackTop visibilityHeight={400} style={{ right: 340 }} />
    </div>
  )
}

function extractFileName(filePath: string): string {
  return filePath.split(/[\\/]/).pop() ?? filePath
}

function mergeRecordsWithTransient(
  records: IndexedFileRecord[],
  prevFiles: IndexedFile[]
): IndexedFile[] {
  const recordMap = new Map(records.map((record) => [record.path, record]))
  const normalized: IndexedFile[] = records.map((record) => ({
    ...record,
    status: 'ready' as const,
    error: undefined
  }))
  const transient = prevFiles.filter((file) => !recordMap.has(file.path) && file.status !== 'ready')
  return [...normalized, ...transient].sort((a, b) => b.updatedAt - a.updatedAt)
}

export default App
