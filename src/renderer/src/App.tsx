import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import type { ReactElement } from 'react'
import { XProvider } from '@ant-design/x'
import type { BubbleListRef } from '@ant-design/x/es/bubble'
import {
  ConfigProvider,
  Form,
  message as antdMessage,
  theme as antdTheme,
  Skeleton
} from 'antd'


import { getTheme } from './theme'
import type { AppSettings } from '../../types/chat'
import { WelcomeScreen, ChatArea, ChatInput, CollectionModal } from './components/chat'
import { ChatSidebar } from './components/chat/ChatSidebar'

import { TopNavBar } from './components/layout/TopNavBar'
import type { AssistantPhase } from './components/chat'
import { GlobalProgress } from './components/GlobalProgress'
import { UpdateNotification } from './components/UpdateNotification'
import { useConversations, useChatWithXChat, useKnowledgeBase, useProgress } from './hooks'
import type { DocumentCollection } from './types/files'

// 性能优化：懒加载设置对话框和知识库面板
const SettingsDialog = lazy(() => import('./components/SettingsDialog'))
const AppSidebar = lazy(() => import('./components/AppSidebar'))

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
    <ConfigProvider theme={providerTheme}>
      <XProvider theme={providerTheme}>
        <AppContent themeMode={themeMode} onThemeChange={setThemeMode} />
      </XProvider>
    </ConfigProvider>
  )
}

interface AppContentProps {
  themeMode: 'light' | 'dark'
  onThemeChange: (mode: 'light' | 'dark') => void
}

function AppContent({ themeMode, onThemeChange }: AppContentProps): ReactElement {
  const [messageApi, contextHolder] = antdMessage.useMessage()
  const { token } = antdTheme.useToken()

  // 输入状态
  const [inputValue, setInputValue] = useState('')
  const [mentionedFiles, setMentionedFiles] = useState<{ token: string; path: string }[]>([])
  const [selectedTags, setSelectedTags] = useState<string[]>([])
  const [activeTab, setActiveTab] = useState<'chat' | 'knowledge' | 'settings'>('chat')
  const [, setCurrentSettings] = useState<AppSettings | null>(null)
  const [collectionModalOpen, setCollectionModalOpen] = useState(false)
  const [editingCollection, setEditingCollection] = useState<DocumentCollection | null>(null)
  const [collectionForm] = Form.useForm()
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null)
  const [initializing, setInitializing] = useState(true)

  const handleTabChange = useCallback((key: 'chat' | 'knowledge' | 'settings') => {
    setActiveTab(key)
  }, [])

  // 全局进度管理
  const { progress } = useProgress()

  // Refs
  const bubbleListRef = useRef<BubbleListRef | null>(null)
  const userChangedScopeRef = useRef(false)

  // 对话管理 Hook
  const {
    activeConversationKey,
    currentMessages,
    conversationItems,
    starredConversationKeys,
    handleActiveConversationChange,
    createNewConversation,
    renameConversation,
    toggleStarConversation,
    handleDeleteConversation,
    loadConversations,
    loadMoreMessages,
    hasMore,
    loading: messagesLoading
  } = useConversations()

  // 知识库管理 Hook
  const {
    files,
    collections,
    availableTags,
    activeDocument,
    activeCollectionId,
    questionScope,
    readyDocuments,
    resolvedCollectionId,
    setActiveCollectionId,
    setQuestionScope,
    syncKnowledgeBase,
    setActiveDocument,
    handleUpload,
    handleReindexDocument,
    handleRemoveDocument,
    handleRefreshKnowledgeBase
  } = useKnowledgeBase({ messageApi })

  const readyFiles = useMemo(() => files.filter((f) => f.status === 'ready'), [files])

  // 聊天流式响应 Hook - 使用 @ant-design/x-sdk
  const {
    isTyping,
    messages: chatMessages,
    sendMessage,
    stopGeneration
  } = useChatWithXChat({
    messageApi,
    conversationKey: activeConversationKey,
    historyMessages: currentMessages,
    onSaveMessage: async (message) => {
      if (activeConversationKey) {
        await window.api.saveMessage(activeConversationKey, message)
      }
    },
    onUpdateMessage: async (key, updates) => {
      await window.api.updateMessage(key, updates)
    }
  })

  // 合并消息：如果 chatMessages 有内容则使用，否则使用历史消息
  const displayMessages = chatMessages.length > 0 ? chatMessages : currentMessages

  // 重新计算 showWelcome - 基于 displayMessages 而不是 currentMessages
  const shouldShowWelcome = useMemo(() => {
    if (!activeConversationKey) return true
    if (displayMessages.length === 0) return true
    // 如果只有一条空的 system 消息，显示欢迎页面
    if (
      displayMessages.length === 1 &&
      displayMessages[0].role === 'system' &&
      !displayMessages[0].content
    )
      return true
    return false
  }, [activeConversationKey, displayMessages])

  const assistantPhase = useMemo<AssistantPhase>(() => {
    // 1. 优先检查后台任务进度
    if (progress) {
      if (progress.error) return 'error'
      // 如果任务未完成且不是错误状态，显示处理中
      if (
        progress.taskType?.toLowerCase() !== 'completed' &&
        progress.taskType?.toLowerCase() !== 'error' &&
        progress.percent < 100
      ) {
        return 'processing'
      }
    }

    // 2. 检查对话状态
    const lastAi = [...displayMessages].reverse().find((m) => m.role === 'ai')
    if (lastAi?.status === 'error') return 'error'
    if (isTyping) {
      if (lastAi?.typing && !lastAi.content.trim()) return 'thinking'
      return 'answering'
    }
    return 'idle'
  }, [displayMessages, isTyping, progress])

  // 初始化
  useEffect(() => {
    void (async () => {
      try {
        const [loadedSettings, snapshot] = await Promise.all([
          window.api.getSettings(),
          window.api.getKnowledgeBase()
        ])
        setCurrentSettings(loadedSettings)
        syncKnowledgeBase(snapshot)

        // 启动时清空选中文档，避免残留来源；仅在用户未手动切换范围时才重置为全库
        setActiveDocument(undefined)
        if (!userChangedScopeRef.current) {
          setQuestionScope('all')
        }

        if (snapshot.files.length > 0) {
          setActiveDocument(snapshot.files[0]?.path)
        }
        if (snapshot.collections.length > 0) {
          setActiveCollectionId((prev) => prev ?? snapshot.collections[0]?.id)
        }

        // 加载对话
        await loadConversations()
      } catch (error) {
        console.error('Failed to initialize app:', error)
      } finally {
        setInitializing(false)
      }
    })()
  }, [
    syncKnowledgeBase,
    setActiveDocument,
    setActiveCollectionId,
    loadConversations,
    setQuestionScope
  ])

  // 窄屏自动隐藏知识库，宽屏恢复显示
  useEffect(() => {
    // 移除未使用的 handleResize 逻辑，或者如果需要响应式处理其他状态请保留
  }, [])

  const handleActiveConversationChangeAndClose = useCallback(
    (key: string) => {
      handleActiveConversationChange(key)
    },
    [handleActiveConversationChange]
  )

  // 滚动到底部 (仅当不是加载更多时)
  useEffect(() => {
    if (!messagesLoading) {
      // 这里很难区分是新消息还是加载更多...
      // 简单的做法：只有当 activeConversationKey 变化或者 typing 时才滚动
      // 或者让 ChatArea 自己处理
    }
    // bubbleListRef.current?.scrollTo({ top: 'bottom', behavior: 'smooth' })
  }, [currentMessages, messagesLoading])

  // 发送消息 - 使用 useChatWithXChat 的 sendMessage
  const handleSend = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (!trimmed || isTyping) return

      // 如果没有活动对话，创建一个新的
      const ensureConversation = async (): Promise<string> => {
        if (!activeConversationKey) {
          return await createNewConversation()
        }
        return activeConversationKey
      }

      void (async () => {
        await ensureConversation()

        let selectedSources: string[] | undefined

        // 优先级：# 选择的文件 > 文档集 > 全库
        if (mentionedFiles.length > 0) {
          // 最高优先级：用户通过 # 明确指定的文件
          selectedSources = mentionedFiles.map((m) => m.path)
        } else if (questionScope === 'collection') {
          // 次优先级：文档集
          if (!resolvedCollectionId) {
            messageApi.warning('请先创建并选择一个文档集')
            return
          }
          const targetCollection = collections.find((c) => c.id === resolvedCollectionId)
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
        // else: 全库检索，selectedSources 保持 undefined

        // 在发送到主进程前记录调试信息，便于追踪渲染端传参
        console.debug('[rag:chat-renderer] sendMessage called', {
          question: trimmed,
          selectedSources,
          selectedTags,
          questionScope,
          mentionedFiles,
          resolvedCollectionId
        })

        setInputValue('')
        setMentionedFiles([])
        setSelectedTags([])
        // 使用 useChatWithXChat 的 sendMessage 发送消息
        sendMessage(trimmed, selectedSources, selectedTags)
      })()
    },
    [
      isTyping,
      activeConversationKey,
      questionScope,
      resolvedCollectionId,
      collections,
      mentionedFiles,
      selectedTags,
      messageApi,
      createNewConversation,
      sendMessage
    ]
  )

  // 点击提示词
  const handlePromptClick = useCallback(
    (content: string): void => {
      if (!content.trim()) return
      if (!isTyping) {
        handleSend(content)
      } else {
        setInputValue(content)
      }
    },
    [isTyping, handleSend]
  )

  // 复制消息
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

  // 文档集相关
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
  }, [
    collectionForm,
    editingCollection,
    handleCollectionModalClose,
    messageApi,
    syncKnowledgeBase,
    setActiveCollectionId,
    setQuestionScope
  ])

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

  if (initializing) {
    return (
      <div
        className="flex flex-col h-screen overflow-hidden"
        style={{ background: token.colorBgLayout }}
      >
        <div
          className="h-10 px-4 flex items-center gap-2"
          style={{ background: token.colorBgElevated }}
        >
          <Skeleton.Avatar active size="small" shape="square" />
          <Skeleton.Input active size="small" style={{ width: 120 }} />
        </div>
        <div className="flex flex-1 overflow-hidden">
          <div
            className="w-72 border-r p-4"
            style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}
          >
            <Skeleton active paragraph={{ rows: 6 }} title={false} />
          </div>
          <div className="flex-1 p-6 overflow-hidden">
            <Skeleton active paragraph={{ rows: 10 }} title />
          </div>
          <div
            className="w-80 border-l p-4"
            style={{ borderColor: token.colorBorderSecondary, background: token.colorBgContainer }}
          >
            <Skeleton active paragraph={{ rows: 6 }} title={false} />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: token.colorBgLayout }}
    >
      {/* 顶部导航栏 */}
      <TopNavBar activeTab={activeTab} onTabChange={handleTabChange} />


      {/* 主内容区域 */}
      <div className="flex flex-1 overflow-hidden relative bg-gray-50 dark:bg-gray-900">
        {contextHolder}

        {/* ---------------- CHAT TAB CONTENT ---------------- */}
        <div className={`flex w-full h-full ${activeTab === 'chat' ? '' : 'hidden'}`}>
          {/* Column 2: Chat Sidebar (Middle) */}
          <div className="border-r border-gray-200 dark:border-gray-800 h-full bg-gray-50/50 dark:bg-gray-900/20">
            <ChatSidebar
              themeMode={themeMode}
              sidebarCollapsed={false}
              conversationItems={conversationItems}
              activeConversationKey={activeConversationKey}
              starredConversationKeys={starredConversationKeys}
              readyDocuments={readyDocuments}
              assistantPhase={assistantPhase}
              processingStatus={progress?.stage}
              onThemeChange={onThemeChange}
              onActiveConversationChange={handleActiveConversationChangeAndClose}
              onCreateNewConversation={createNewConversation}
              onRenameConversation={renameConversation}
              onToggleStarConversation={toggleStarConversation}
              onDeleteConversation={handleDeleteConversation}
              simpleMode={true}
            />
          </div>

          {/* Column 3: Chat Area (Right) */}
          <section className="flex min-w-0 flex-1 flex-col relative p-2 bg-gray-50 dark:bg-gray-900">
            <main className="flex flex-1 flex-col overflow-hidden bg-white dark:bg-gray-950 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800 relative z-0">
              {shouldShowWelcome ? (
                <WelcomeScreen
                  themeMode={themeMode}
                  readyDocuments={readyDocuments}
                  onPromptClick={handlePromptClick}
                />
              ) : (
                <ChatArea
                  themeMode={themeMode}
                  currentMessages={displayMessages}
                  bubbleListRef={bubbleListRef}
                  isTyping={isTyping}
                  copiedMessageKey={copiedMessageKey}
                  onCopyMessage={handleCopyMessage}
                  onRetryMessage={handleRetryMessage}
                  onLoadMore={loadMoreMessages}
                  hasMore={hasMore}
                  conversationKey={activeConversationKey}
                  conversationLabel={
                    activeConversationKey
                      ? conversationItems.find((c) => c.key === activeConversationKey)?.label
                      : undefined
                  }
                  isConversationStarred={
                    !!activeConversationKey && starredConversationKeys.includes(activeConversationKey)
                  }
                  onRenameConversation={renameConversation}
                  onToggleStarConversation={toggleStarConversation}
                  onPromptClick={handlePromptClick}
                />
              )}

              {/* 输入区域移动到 main 内部底部，以保持圆角卡片风格 */}
              <div className="border-t border-gray-100 dark:border-gray-800/50">
                <ChatInput
                  themeMode={themeMode}
                  inputValue={inputValue}
                  isTyping={isTyping}
                  readyDocuments={readyDocuments}
                  questionScope={questionScope}
                  activeDocument={activeDocument}
                  collections={collections}
                  resolvedCollectionId={resolvedCollectionId}
                  showQuickQuestions={displayMessages.length <= 1}
                  hasReadyFiles={readyDocuments > 0}
                  readyFiles={readyFiles}
                  mentionedFiles={mentionedFiles}
                  availableTags={availableTags}
                  selectedTags={selectedTags}
                  onSelectedTagsChange={setSelectedTags}
                  onMentionFilesChange={setMentionedFiles}
                  onInputChange={setInputValue}
                  onSubmit={handleSend}
                  onQuestionScopeChange={(scope) => {
                    userChangedScopeRef.current = true
                    setQuestionScope(scope)
                    if (scope === 'collection') {
                      if (!resolvedCollectionId && collections[0]) {
                        setActiveCollectionId((prev) => prev ?? collections[0].id)
                      }
                    }
                  }}
                  onCollectionChange={setActiveCollectionId}
                  onStopGeneration={stopGeneration}
                  onPromptClick={handlePromptClick}
                />
              </div>
            </main>
          </section>
        </div>

        {/* ---------------- KNOWLEDGE TAB CONTENT ---------------- */}
        <div className={`w-full h-full ${activeTab === 'knowledge' ? '' : 'hidden'}`}>
          <Suspense
            fallback={
              <div
                className="w-full h-full px-4 py-6"
                style={{
                  background: token.colorBgContainer
                }}
              >
                <Skeleton active paragraph={{ rows: 8 }} title={false} />
              </div>
            }
          >
            <AppSidebar
              fullWidth
              collections={collections}
              activeCollectionId={activeCollectionId}
              activeDocument={activeDocument}
              files={files}
              onCollectionChange={(key) => setActiveCollectionId(key || undefined)}
              onCreateCollection={openCreateCollection}
              onEditCollection={openEditCollection}
              onDeleteCollection={(id) => void handleDeleteCollection(id)}
              onUpload={(targetCollectionId) => void handleUpload(targetCollectionId)}
              onAddUrl={async (url, targetCollectionId) => {
                const result = await window.api.processUrl(url)
                if (result.success) {
                  const collection = collections.find((c) => c.id === targetCollectionId)
                  if (collection) {
                    const snapshot = await window.api.updateCollection({
                      id: targetCollectionId,
                      files: [...collection.files, url]
                    })
                    syncKnowledgeBase(snapshot)
                  }
                } else {
                  throw new Error(result.error || '导入失败')
                }
              }}
              onUpdateActiveDocument={setActiveDocument}
              onReindexDocument={handleReindexDocument}
              onRemoveDocument={handleRemoveDocument}
              onRefreshKnowledgeBase={handleRefreshKnowledgeBase}
              onRebuildAllIndex={async () => {
                try {
                  const snapshot = await window.api.rebuildKnowledgeBase()
                  syncKnowledgeBase(snapshot)
                  messageApi.success('知识库索引重建完成')
                } catch (error) {
                  console.error('Failed to rebuild knowledge base:', error)
                  messageApi.error('重建索引失败，请查看日志')
                }
              }}
            />
          </Suspense>
        </div>

        {/* ---------------- SETTINGS TAB CONTENT ---------------- */}
        <div className={`w-full h-full ${activeTab === 'settings' ? '' : 'hidden'}`}>
          <Suspense
            fallback={
              <div
                className="w-full h-full px-6 py-6"
                style={{ background: token.colorBgContainer }}
              >
                <Skeleton active paragraph={{ rows: 10 }} title />
              </div>
            }
          >
            <SettingsDialog
              isOpen={true}
              fullScreen
              onClose={() => setActiveTab('chat')}
              onSaved={(saved) => {
                setCurrentSettings(saved)
                setActiveTab('chat')
              }}
            />
          </Suspense>
        </div>

        {/* 文档集编辑弹窗 */}
        <CollectionModal
          open={collectionModalOpen}
          editingCollection={editingCollection}
          collectionForm={collectionForm}
          fileOptions={collectionFileOptions}
          onClose={handleCollectionModalClose}
          onSubmit={() => void handleCollectionSubmit()}
        />



        {/* 更新通知组件 - 显示在右上角 */}
        <UpdateNotification />
      </div>

      {/* 全局进度条 - 底部显示 */}
      <GlobalProgress progress={progress} />
    </div>
  )
}

export default App
