import { useCallback, useEffect, useMemo, useRef, useState, lazy, Suspense } from 'react'
import type { ReactElement } from 'react'
import { XProvider } from '@ant-design/x'
import type { BubbleListRef } from '@ant-design/x/es/bubble'
import { Form, FloatButton, message as antdMessage, theme as antdTheme, Spin } from 'antd'

import { getTheme } from './theme'
import type { AppSettings } from './components/SettingsDialog'
import { ChatSidebar, WelcomeScreen, ChatArea, ChatInput, CollectionModal } from './components/chat'
import { GlobalProgress } from './components/GlobalProgress'
import { useConversations, useChatWithXChat, useKnowledgeBase, useProgress } from './hooks'
import type { DocumentCollection } from './types/files'

// 性能优化：懒加载设置对话框和知识库面板
const SettingsDialog = lazy(() => import('./components/SettingsDialog'))
const AppSidebar = lazy(() => import('./components/AppSidebar'))
const TitleBar = lazy(() => import('./components/TitleBar'))

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

  // 输入状态
  const [inputValue, setInputValue] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [, setCurrentSettings] = useState<AppSettings | null>(null)
  const [collectionModalOpen, setCollectionModalOpen] = useState(false)
  const [editingCollection, setEditingCollection] = useState<DocumentCollection | null>(null)
  const [collectionForm] = Form.useForm()
  const [copiedMessageKey, setCopiedMessageKey] = useState<string | null>(null)
  const [sidebarCollapsed] = useState(false)

  // 全局进度管理
  const { progress } = useProgress()

  // Refs
  const bubbleListRef = useRef<BubbleListRef | null>(null)

  // 对话管理 Hook
  const {
    activeConversationKey,
    currentMessages,
    conversationItems,
    handleActiveConversationChange,
    createNewConversation,
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
    activeDocument,
    activeCollectionId,
    questionScope,
    readyDocuments,
    activeFile,
    resolvedCollectionId,
    setActiveCollectionId,
    setQuestionScope,
    syncKnowledgeBase,
    setActiveDocument,
    handleUpload,
    handleReindexDocument,
    handleRemoveDocument
  } = useKnowledgeBase({ messageApi })

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
      }
    })()
  }, [syncKnowledgeBase, setActiveDocument, setActiveCollectionId, loadConversations])

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

        setInputValue('')
        // 使用 useChatWithXChat 的 sendMessage 发送消息
        sendMessage(trimmed, selectedSources)
      })()
    },
    [
      isTyping,
      activeConversationKey,
      questionScope,
      activeDocument,
      resolvedCollectionId,
      collections,
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

  return (
    <div
      className="flex flex-col h-screen overflow-hidden"
      style={{ background: token.colorBgLayout }}
    >
      {/* 自定义标题栏 */}
      <Suspense fallback={<div className="h-10" style={{ background: token.colorBgElevated }} />}>
        <TitleBar title="智汇" />
      </Suspense>

      {/* 全局进度条 */}
      <GlobalProgress progress={progress} />

      {/* 主内容区域 */}
      <div className="flex flex-1 overflow-hidden">
        {contextHolder}

        {/* 左侧：对话历史 */}
        <ChatSidebar
          themeMode={themeMode}
          sidebarCollapsed={sidebarCollapsed}
          conversationItems={conversationItems}
          activeConversationKey={activeConversationKey}
          readyDocuments={readyDocuments}
          onThemeChange={onThemeChange}
          onActiveConversationChange={handleActiveConversationChange}
          onCreateNewConversation={createNewConversation}
          onDeleteConversation={handleDeleteConversation}
          onOpenSettings={() => setSettingsOpen(true)}
        />

        {/* 中间：聊天区域 */}
        <section className="flex min-w-0 flex-1 flex-col">
          <main className="flex flex-1 flex-col overflow-hidden">
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
              />
            )}
          </main>

          {/* 输入区域 */}
          <ChatInput
            themeMode={themeMode}
            inputValue={inputValue}
            isTyping={isTyping}
            readyDocuments={readyDocuments}
            questionScope={questionScope}
            activeDocument={activeDocument}
            activeFile={activeFile}
            collections={collections}
            resolvedCollectionId={resolvedCollectionId}
            showQuickQuestions={displayMessages.length <= 1}
            hasReadyFiles={readyDocuments > 0}
            onInputChange={setInputValue}
            onSubmit={handleSend}
            onQuestionScopeChange={setQuestionScope}
            onCollectionChange={setActiveCollectionId}
            onStopGeneration={stopGeneration}
            onPromptClick={handlePromptClick}
          />
        </section>

        {/* 右侧：知识库面板（懒加载） */}
        <Suspense
          fallback={
            <div className="w-80 flex items-center justify-center">
              <Spin />
            </div>
          }
        >
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
          onAddUrl={async (url, targetCollectionId) => {
              const result = await window.api.processUrl(url)
              if (result.success) {
                // 将 URL 添加到文档集
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

        {/* 文档集编辑弹窗 */}
        <CollectionModal
          open={collectionModalOpen}
          editingCollection={editingCollection}
          collectionForm={collectionForm}
          fileOptions={collectionFileOptions}
          onClose={handleCollectionModalClose}
          onSubmit={() => void handleCollectionSubmit()}
        />

        {/* 设置弹窗（懒加载） */}
        {settingsOpen && (
          <Suspense fallback={null}>
            <SettingsDialog
              isOpen={settingsOpen}
              onClose={() => setSettingsOpen(false)}
              onSaved={(saved) => {
                setCurrentSettings(saved)
                setSettingsOpen(false)
              }}
            />
          </Suspense>
        )}

        {/* 浮动按钮 - 回到顶部 */}
        <FloatButton.BackTop visibilityHeight={400} style={{ right: 340 }} />
      </div>
    </div>
  )
}

export default App
