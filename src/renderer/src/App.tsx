import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Actions,
  Bubble,
  type BubbleItemType,
  Prompts,
  Sender,
  Sources,
  Welcome,
  XProvider
} from '@ant-design/x'
import type { BubbleListRef } from '@ant-design/x/es/bubble'
import type { RoleType } from '@ant-design/x/es/bubble/interface'
import type { PromptsItemType } from '@ant-design/x/es/prompts'
import {
  Alert,
  Divider,
  Form,
  Input,
  Modal,
  Segmented,
  Select,
  Space,
  Tag,
  theme as antdTheme,
  message as antdMessage
} from 'antd'
import {
  SettingOutlined,
  DeleteOutlined,
  MoonFilled,
  SunFilled,
  PlusOutlined
} from '@ant-design/icons'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { AppSidebar } from './components/AppSidebar'
import { SettingsDialog, type AppSettings } from './components/SettingsDialog'
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
}

const INITIAL_MESSAGE: ChatMessage = {
  key: 'system_welcome',
  role: 'system',
  content: '欢迎使用本地 RAG 助手，先在左侧导入文档，然后开始对话。'
}

function App(): ReactElement {
  const prefersDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches
  const [themeMode, setThemeMode] = useState<'light' | 'dark'>(prefersDark ? 'dark' : 'light')

  const providerTheme = useMemo(
    () => ({
      algorithm: themeMode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
    }),
    [themeMode]
  )

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
  const [inputValue, setInputValue] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([INITIAL_MESSAGE])
  const [files, setFiles] = useState<IndexedFile[]>([])
  const [collections, setCollections] = useState<DocumentCollection[]>([])
  const [activeDocument, setActiveDocument] = useState<string | undefined>(undefined)
  const [activeCollectionId, setActiveCollectionId] = useState<string | undefined>(undefined)
  const [isTyping, setIsTyping] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [currentSettings, setCurrentSettings] = useState<AppSettings | null>(null)
  const [questionScope, setQuestionScope] = useState<QuestionScope>('all')
  const [collectionModalOpen, setCollectionModalOpen] = useState(false)
  const [editingCollection, setEditingCollection] = useState<DocumentCollection | null>(null)
  const [collectionForm] = Form.useForm()
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

      if (snapshot.collections.length === 0) {
        setActiveCollectionId(undefined)
        updateActiveDocument(undefined)
      } else if (!snapshot.collections.some((collection) => collection.id === activeCollectionId)) {
        const fallbackCollection = snapshot.collections[0]
        setActiveCollectionId(fallbackCollection?.id)
        updateActiveDocument(fallbackCollection?.files[0])
      } else {
        const currentCollection = snapshot.collections.find(
          (collection) => collection.id === activeCollectionId
        )
        if (currentCollection) {
          if (currentCollection.files.length === 0) {
            updateActiveDocument(undefined)
          } else if (!currentCollection.files.includes(activeDocument ?? '')) {
            updateActiveDocument(currentCollection.files[0])
          }
        }
      }

      if (snapshot.collections.length === 0 && questionScope === 'collection') {
        setQuestionScope('all')
      }
    },
    [activeCollectionId, activeDocument, questionScope, updateActiveDocument]
  )

  const readyDocuments = useMemo(
    () => files.filter((file) => file.status === 'ready').length,
    [files]
  )
  const processingFiles = useMemo(
    () => files.filter((file) => file.status === 'processing'),
    [files]
  )
  const errorDocuments = useMemo(
    () => files.filter((file) => file.status === 'error').length,
    [files]
  )
  const activeFile = useMemo(
    () => files.find((file) => file.path === activeDocument),
    [files, activeDocument]
  )

  const senderScopeOptions = useMemo(
    () => [
      { label: '全库', value: 'all' },
      {
        label: '当前文档',
        value: 'active',
        disabled: !activeDocument
      },
      {
        label: '文档集',
        value: 'collection',
        disabled: collections.length === 0
      }
    ],
    [activeDocument, collections.length]
  )

  const createMessageKey = useCallback((prefix: string): string => {
    idCounterRef.current += 1
    return `${prefix}-${idCounterRef.current}`
  }, [])

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
      } catch (error) {
        console.error('Failed to initialize app:', error)
      }
    })()
  }, [syncKnowledgeBase, updateActiveDocument])

  useEffect(() => {
    const handleToken = (tokenChunk: string): void => {
      setMessages((prev) =>
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
        setMessages((prev) =>
          prev.map((message) =>
            message.key === streamMessageKeyRef.current
              ? { ...message, typing: false, sources: pendingSourcesRef.current }
              : message
          )
        )
      }
      pendingSourcesRef.current = []
      streamMessageKeyRef.current = null
      setIsTyping(false)
    }

    const handleError = (error: string): void => {
      setMessages((prev) => [
        ...prev,
        {
          key: createMessageKey('error'),
          role: 'system',
          content: `发生错误：${error}`
        }
      ])
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
  }, [createMessageKey, messageApi])

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

  const handleCollectionChange = useCallback(
    (key: string) => {
      setActiveCollectionId(key)
      const nextCollection = collections.find((collection) => collection.id === key)
      if (nextCollection?.files.length) {
        updateActiveDocument(nextCollection.files[0])
      } else {
        updateActiveDocument(undefined)
      }
    },
    [collections, updateActiveDocument]
  )

  useEffect(() => {
    bubbleListRef.current?.scrollTo({ top: 'bottom', behavior: 'smooth' })
  }, [messages])

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

  const handleReindexDocument = useCallback(
    async (filePath: string) => {
      setFiles((prev) =>
        prev.map((file) =>
          file.path === filePath
            ? { ...file, status: 'processing', error: undefined, updatedAt: Date.now() }
            : file
        )
      )

      try {
        const snapshot = await window.api.reindexIndexedFile(filePath)
        syncKnowledgeBase(snapshot)
        messageApi.success('重新索引完成')
      } catch (error) {
        console.error('Failed to reindex document:', error)
        setFiles((prev) =>
          prev.map((file) =>
            file.path === filePath
              ? {
                  ...file,
                  status: 'error',
                  error: '重新索引失败，请检查日志',
                  updatedAt: Date.now()
                }
              : file
          )
        )
        messageApi.error('重新索引失败，请检查日志')
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
          const fallbackPath = snapshot.files[0]?.path
          updateActiveDocument(fallbackPath)
        }
        if (snapshot.collections.length === 0) {
          setActiveCollectionId(undefined)
        }
        messageApi.success('文档已从知识库移除')
      } catch (error) {
        console.error('Failed to remove document:', error)
        messageApi.error('移除文档失败，请检查日志')
      }
    },
    [activeDocument, messageApi, syncKnowledgeBase, updateActiveDocument]
  )

  const handleSend = (text: string): void => {
    const trimmed = text.trim()
    if (!trimmed || isTyping) return

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
      content: trimmed
    }
    const aiMessageKey = createMessageKey('ai')
    const aiMessage: ChatMessage = {
      key: aiMessageKey,
      role: 'ai',
      content: '',
      typing: true
    }

    setMessages((prev) => [...prev, userMessage, aiMessage])
    setInputValue('')
    setIsTyping(true)
    streamMessageKeyRef.current = aiMessageKey
    pendingSourcesRef.current = []

    window.api.chat({ question: trimmed, sources: selectedSources })
  }

  const handleActionClick = (actionKey: string): void => {
    switch (actionKey) {
      case 'newCollection':
        openCreateCollection()
        break
      case 'settings':
        setSettingsOpen(true)
        break
      case 'clear':
        setMessages([INITIAL_MESSAGE])
        setInputValue('')
        streamMessageKeyRef.current = null
        break
      case 'theme':
        onThemeChange(themeMode === 'dark' ? 'light' : 'dark')
        break
      default:
        break
    }
  }

  const handlePromptClick = (content: string): void => {
    if (!content.trim()) return
    if (!isTyping) {
      handleSend(content)
    } else {
      setInputValue(content)
    }
  }

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

  const bubbleItems = useMemo<BubbleItemType[]>(
    () =>
      messages.map((message) => ({
        key: message.key,
        role: message.role,
        content:
          message.content.trim().length > 0 ? (
            <div className="prose prose-sm max-w-none dark:prose-invert">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
            </div>
          ) : (
            <span className="italic text-gray-400">……</span>
          ),
        typing: message.typing,
        streaming: message.typing,
        extraInfo: { sources: message.sources }
      })),
    [messages]
  )

  const promptItems = useMemo<PromptsItemType[]>(
    () => [
      {
        key: 'summary',
        label: '总结当前文档',
        description: activeFile
          ? `请帮我总结《${activeFile.name}》的核心观点并列出要点`
          : '请总结当前知识库的核心观点'
      },
      {
        key: 'facts',
        label: '提取关键信息',
        description: activeFile
          ? `列出《${activeFile.name}》中最重要的事实与数据`
          : '列出最新索引文档中的重要事实'
      },
      {
        key: 'compare',
        label: '内容对比',
        description: '比较两个不同来源的观点是否一致'
      },
      {
        key: 'plan',
        label: '生成计划',
        description: '根据文档内容生成下一步行动计划'
      }
    ],
    [activeFile]
  )

  const roles = useMemo<RoleType>(
    () => ({
      user: {
        placement: 'end',
        variant: 'shadow',
        style: {
          backgroundColor: themeMode === 'dark' ? '#177ddc' : '#1677ff',
          color: '#fff'
        }
      },
      ai: {
        placement: 'start',
        variant: 'filled',
        style: {
          backgroundColor: themeMode === 'dark' ? '#1f1f1f' : '#fff',
          border: themeMode === 'dark' ? '1px solid #303030' : '1px solid #f0f0f0'
        },
        footer: (_, info) => {
          const sources = info.extraInfo?.sources as ChatSource[] | undefined
          if (!sources?.length) return null
          return (
            <Sources
              inline
              items={sources.map((source, index) => ({
                key: `${source.fileName}-${index}`,
                title: source.fileName,
                description: source.pageNumber ? `p.${source.pageNumber}` : undefined
              }))}
              title="引用来源"
            />
          )
        }
      },
      system: {
        placement: 'start',
        variant: 'borderless'
      }
    }),
    [themeMode]
  )

  const actionItems = useMemo(() => {
    const themeLabel = themeMode === 'dark' ? '切换为浅色' : '切换为深色'
    const themeIcon = themeMode === 'dark' ? <SunFilled /> : <MoonFilled />
    return [
      { key: 'newCollection', label: '新建文档集', icon: <PlusOutlined /> },
      { key: 'settings', label: '模型设置', icon: <SettingOutlined /> },
      { key: 'clear', label: '清空对话', icon: <DeleteOutlined /> },
      { key: 'theme', label: themeLabel, icon: themeIcon }
    ]
  }, [themeMode])

  const showWelcome = messages.length === 1 && messages[0].role === 'system'

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
      {contextHolder}
      <AppSidebar
        collections={collections}
        activeCollectionId={activeCollectionId}
        activeDocument={activeDocument}
        files={files}
        onCollectionChange={handleCollectionChange}
        onCreateCollection={openCreateCollection}
        onEditCollection={openEditCollection}
        onDeleteCollection={(id) => void handleDeleteCollection(id)}
        onUpload={(id) => void handleUpload(id)}
        onUpdateActiveDocument={updateActiveDocument}
        onReindexDocument={(path) => void handleReindexDocument(path)}
        onRemoveDocument={(path) => void handleRemoveDocument(path)}
      />

      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
          <div>
            <h1>RAG Desktop</h1>
            <p>
              当前模型：{currentSettings?.chatModel ?? '加载中…'} ｜ 向量：
              {currentSettings?.embeddingModel ?? '加载中…'}
            </p>
            <Space size="small" wrap className="app-stats">
              <Tag color="blue">文档 {files.length}</Tag>
              <Tag color="green">已就绪 {readyDocuments}</Tag>
              <Tag color="orange">索引中 {processingFiles.length}</Tag>
              <Tag color="red">失败 {errorDocuments}</Tag>
              <Tag color="purple">文档集 {collections.length}</Tag>
            </Space>
          </div>
          <Actions items={actionItems} onClick={({ key }) => handleActionClick(key)} />
        </header>

        {processingFiles.length > 0 && (
          <Alert
            className="processing-alert"
            type="info"
            showIcon
            message={`有 ${processingFiles.length} 个文档正在索引`}
            description={processingFiles
              .slice(0, 3)
              .map((file) => file.name)
              .join('，')}
          />
        )}

        <main className="flex flex-1 flex-col gap-4 overflow-y-auto bg-gray-50 px-6 py-6 dark:bg-gray-900">
          {showWelcome && (
            <Welcome
              variant="borderless"
              title="上传任意文档"
              description="支持拖拽导入与多文档合并检索，引用结果自动附带来源。"
            />
          )}
          <Bubble.List
            ref={(instance) => {
              bubbleListRef.current = instance
            }}
            items={bubbleItems}
            role={roles}
            autoScroll
          />
          <Divider dashed className="text-gray-400">
            快捷提问
          </Divider>
          <Prompts
            wrap
            items={promptItems}
            onItemClick={({ data }) =>
              handlePromptClick(String(data.description ?? data.label ?? ''))
            }
          />
        </main>

        <footer className="border-t border-gray-200 bg-white px-6 py-4 pb-6 dark:border-gray-700 dark:bg-gray-900">
          <div className="mb-2 flex items-center justify-between gap-3">
            <Segmented
              options={senderScopeOptions}
              size="small"
              value={questionScope}
              onChange={(value) => setQuestionScope(value as QuestionScope)}
            />
            {questionScope === 'collection' && (
              <Select
                size="small"
                className="min-w-[200px]"
                placeholder="选择文档集"
                value={resolvedCollectionId}
                options={collections.map((collection) => ({
                  label: `${collection.name} (${collection.files.length})`,
                  value: collection.id
                }))}
                onChange={(value) => setActiveCollectionId(value)}
              />
            )}
            <span className="text-xs text-gray-500 dark:text-gray-400">
              {questionScope === 'active'
                ? '仅针对当前文档回答'
                : questionScope === 'collection'
                  ? '限定在所选文档集中检索'
                  : '在整个知识库中检索'}
            </span>
          </div>
          <Sender
            value={inputValue}
            onChange={(value) => setInputValue(value)}
            onSubmit={(value) => handleSend(value)}
            placeholder="向本地知识库提问…"
            loading={isTyping}
            submitType="enter"
          />
        </footer>
      </section>

      <Modal
        title={editingCollection ? '编辑文档集' : '新建文档集'}
        open={collectionModalOpen}
        onCancel={handleCollectionModalClose}
        onOk={() => void handleCollectionSubmit()}
        okText={editingCollection ? '保存' : '创建'}
        cancelText="取消"
        destroyOnClose
        centered
      >
        <Form form={collectionForm} layout="vertical">
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: '请输入文档集名称' }]}
          >
            <Input placeholder="例如：研报摘要" />
          </Form.Item>
          <Form.Item label="描述" name="description">
            <Input.TextArea placeholder="补充说明该文档集的用途" rows={2} />
          </Form.Item>
          <Form.Item label="包含文档" name="files">
            <Select
              mode="multiple"
              placeholder="选择要加入的文档（可留空，后续再导入）"
              options={collectionFileOptions}
              optionFilterProp="label"
            />
          </Form.Item>
        </Form>
      </Modal>

      <SettingsDialog
        isOpen={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onSaved={(saved) => {
          setCurrentSettings(saved)
          setSettingsOpen(false)
        }}
      />
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
