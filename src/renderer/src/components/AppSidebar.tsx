import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  SyncOutlined,
  UploadOutlined,
  MoreOutlined,
  DatabaseOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  SearchOutlined,
  FilePdfOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FileUnknownOutlined,
  FileMarkdownOutlined,
  InboxOutlined,
  BookOutlined,
  LinkOutlined,
  GlobalOutlined,
  AppstoreOutlined,
  UnorderedListOutlined
} from '@ant-design/icons'
import {
  Button,
  Popconfirm,
  Tag,
  theme as antdTheme,
  Input,
  Segmented,
  Tooltip,
  Dropdown,
  Typography,
  Flex,
  Modal,
  message,
  Empty
} from 'antd'
import type { DocumentCollection, IndexedFile } from '../types/files'

interface AppSidebarProps {
  collections: DocumentCollection[]
  activeCollectionId?: string
  activeDocument?: string
  files: IndexedFile[]
  fullWidth?: boolean
  onCollectionChange: (key: string) => void
  onCreateCollection: () => void
  onEditCollection: (collection: DocumentCollection) => void
  onDeleteCollection: (collectionId: string) => void
  onUpload: (targetCollectionId: string) => void
  onAddUrl: (url: string, targetCollectionId: string) => Promise<void>
  onUpdateActiveDocument: (path?: string) => void
  onReindexDocument: (filePath: string) => void
  onRemoveDocument: (filePath: string) => void
  onRebuildAllIndex?: () => void
  onRefreshKnowledgeBase?: () => void
}

const statusConfig: Record<
  IndexedFile['status'],
  { text: string; color: string; icon: ReactElement; bgColor: string }
> = {
  processing: {
    text: '索引中',
    color: 'processing',
    icon: <ClockCircleOutlined spin />,
    bgColor: 'rgba(24, 144, 255, 0.1)'
  },
  ready: {
    text: '就绪',
    color: 'success',
    icon: <CheckCircleOutlined />,
    bgColor: 'rgba(82, 196, 26, 0.1)'
  },
  error: {
    text: '失败',
    color: 'error',
    icon: <ExclamationCircleOutlined />,
    bgColor: 'rgba(255, 77, 79, 0.1)'
  }
}

// 根据文件信息获取图标和颜色
function getFileIconInfo(
  fileName: string,
  sourceType?: 'file' | 'url',
  filePath?: string
): { icon: ReactElement; color: string; bgColor: string } {
  const isUrl =
    sourceType === 'url' ||
    fileName.startsWith('http://') ||
    fileName.startsWith('https://') ||
    filePath?.startsWith('http://') ||
    filePath?.startsWith('https://')

  if (isUrl) {
    return {
      icon: <GlobalOutlined />,
      color: '#722ed1',
      bgColor: 'rgba(114, 46, 209, 0.1)'
    }
  }

  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf':
      return {
        icon: <FilePdfOutlined />,
        color: '#ff4d4f',
        bgColor: 'rgba(255, 77, 79, 0.1)'
      }
    case 'doc':
    case 'docx':
      return {
        icon: <FileWordOutlined />,
        color: '#1890ff',
        bgColor: 'rgba(24, 144, 255, 0.1)'
      }
    case 'xls':
    case 'xlsx':
      return {
        icon: <FileExcelOutlined />,
        color: '#52c41a',
        bgColor: 'rgba(82, 196, 26, 0.1)'
      }
    case 'txt':
      return {
        icon: <FileTextOutlined />,
        color: '#faad14',
        bgColor: 'rgba(250, 173, 20, 0.1)'
      }
    case 'md':
    case 'markdown':
      return {
        icon: <FileMarkdownOutlined />,
        color: '#13c2c2',
        bgColor: 'rgba(19, 194, 194, 0.1)'
      }
    case 'html':
    case 'htm':
      return {
        icon: <GlobalOutlined />,
        color: '#722ed1',
        bgColor: 'rgba(114, 46, 209, 0.1)'
      }
    default:
      return {
        icon: <FileUnknownOutlined />,
        color: '#8c8c8c',
        bgColor: 'rgba(140, 140, 140, 0.1)'
      }
  }
}

export function AppSidebar({
  collections,
  activeCollectionId,
  activeDocument,
  files,
  fullWidth = false,
  onCollectionChange,
  onCreateCollection,
  onEditCollection,
  onDeleteCollection,
  onUpload,
  onAddUrl,
  onUpdateActiveDocument,
  onReindexDocument,
  onRemoveDocument,
  onRebuildAllIndex,
  onRefreshKnowledgeBase
}: AppSidebarProps): ReactElement {
  const { token } = antdTheme.useToken()

  // URL 输入模态框状态
  const [urlModalOpen, setUrlModalOpen] = useState(false)
  const [urlInput, setUrlInput] = useState('')
  const [targetCollectionForUrl, setTargetCollectionForUrl] = useState<string>('')

  // 视图模式：grid 或 list
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid')

  // 搜索和排序状态
  const [collectionQuery, setCollectionQuery] = useState('')
  const [docQuery, setDocQuery] = useState('')
  const [sortKey, setSortKey] = useState<'updatedAt' | 'name' | 'chunkCount'>('updatedAt')

  const handleOpenUrlModal = (collectionId: string): void => {
    setTargetCollectionForUrl(collectionId)
    setUrlInput('')
    setUrlModalOpen(true)
  }

  const handleAddUrl = async (): Promise<void> => {
    if (!urlInput.trim()) {
      message.warning('请输入 URL')
      return
    }

    try {
      new URL(urlInput.trim())
    } catch {
      message.error('请输入有效的 URL')
      return
    }

    const url = urlInput.trim()
    const targetId = targetCollectionForUrl

    setUrlModalOpen(false)
    setUrlInput('')

    onAddUrl(url, targetId)
      .then(() => {
        message.success('URL 内容已添加到知识库')
      })
      .catch((error) => {
        message.error(`添加失败: ${error instanceof Error ? error.message : '未知错误'}`)
      })
  }

  // 当前选中的文档集
  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId),
    [collections, activeCollectionId]
  )

  // 过滤文档集
  const filteredCollections = useMemo(() => {
    if (!collectionQuery.trim()) return collections
    return collections.filter((c) =>
      c.name.toLowerCase().includes(collectionQuery.trim().toLowerCase())
    )
  }, [collections, collectionQuery])

  // 当前文档集的文件
  const collectionFiles = useMemo(
    () =>
      activeCollection ? files.filter((file) => activeCollection.files.includes(file.path)) : [],
    [activeCollection, files]
  )

  // 过滤和排序后的文件
  const displayedFiles = useMemo(() => {
    const keyword = docQuery.trim().toLowerCase()
    const filtered = keyword
      ? collectionFiles.filter((f) => f.name.toLowerCase().includes(keyword))
      : collectionFiles
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'chunkCount') return (b.chunkCount ?? 0) - (a.chunkCount ?? 0)
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })
    return sorted
  }, [collectionFiles, docQuery, sortKey])

  // 统计信息
  const totalFiles = files.length

  return (
    <div
      className={`flex h-full ${fullWidth ? 'w-full' : 'w-80'}`}
      style={{ background: token.colorBgContainer }}
    >
      {/* ========== 左栏：文档集列表 ========== */}
      <aside
        className="flex flex-col h-full w-72 flex-shrink-0"
        style={{
          borderRight: `1px solid ${token.colorBorderSecondary}`,
          background: token.colorBgLayout
        }}
      >
        {/* 头部 */}
        <div
          className="px-4 pt-5 pb-4"
          style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
        >
          <Flex align="center" gap={12} className="mb-5">
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
              }}
            >
              <DatabaseOutlined style={{ fontSize: 20, color: '#fff' }} />
            </div>
            <div>
              <Typography.Title level={5} style={{ margin: 0, lineHeight: 1.2 }}>
                知识库
              </Typography.Title>
              <Typography.Text type="secondary" className="text-xs">
                {collections.length} 个文档集 · {totalFiles} 个文档
              </Typography.Text>
            </div>
          </Flex>

          {/* 操作按钮 */}
          <Flex gap={8} style={{ marginTop: 20, marginBottom: 20 }}>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onCreateCollection}
              className="flex-1"
              style={{
                background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
                border: 'none',
                borderRadius: 10,
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
              }}
            >
              新建文档集
            </Button>
            {files.length > 0 && onRefreshKnowledgeBase && (
              <Tooltip title="增量更新">
                <Button
                  type="default"
                  icon={<SyncOutlined />}
                  onClick={onRefreshKnowledgeBase}
                  style={{ borderRadius: 10 }}
                />
              </Tooltip>
            )}
            {files.length > 0 && onRebuildAllIndex && (
              <Tooltip title="重建索引">
                <Button
                  type="default"
                  icon={<ReloadOutlined />}
                  onClick={onRebuildAllIndex}
                  style={{ borderRadius: 10 }}
                />
              </Tooltip>
            )}
          </Flex>

          {/* 搜索框 */}
          <Input
            placeholder="搜索文档集..."
            allowClear
            prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
            value={collectionQuery}
            onChange={(e) => setCollectionQuery(e.target.value)}
            style={{ borderRadius: 10 }}
            variant="filled"
          />
        </div>

        {/* 文档集列表 */}
        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {filteredCollections.length > 0 ? (
            filteredCollections.map((collection) => {
              const isActive = collection.id === activeCollectionId
              return (
                <div
                  key={collection.id}
                  className="group relative rounded-xl p-3 cursor-pointer transition-all duration-200"
                  onClick={() => onCollectionChange(collection.id)}
                  style={{
                    background: isActive ? token.colorPrimaryBg : 'transparent',
                    border: isActive
                      ? `1px solid ${token.colorPrimaryBorder}`
                      : '1px solid transparent'
                  }}
                >
                  {/* 选中指示器 */}
                  {isActive && (
                    <div
                      className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                      style={{ background: token.colorPrimary }}
                    />
                  )}

                  <div className="flex items-center gap-3">
                    <div
                      className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center transition-all"
                      style={{
                        background: isActive
                          ? `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`
                          : token.colorFillSecondary
                      }}
                    >
                      <FolderOpenOutlined
                        style={{
                          fontSize: 18,
                          color: isActive ? '#fff' : token.colorTextSecondary
                        }}
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <Typography.Text
                        className="block truncate font-medium text-sm"
                        style={{ color: isActive ? token.colorPrimary : token.colorText }}
                      >
                        {collection.name}
                      </Typography.Text>
                      <Typography.Text type="secondary" className="text-xs">
                        {collection.files.length} 个文档
                      </Typography.Text>
                    </div>

                    {/* 悬停操作 */}
                    <div
                      className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Tooltip title="上传文件">
                        <Button
                          type="text"
                          size="small"
                          icon={<UploadOutlined style={{ fontSize: 12 }} />}
                          onClick={() => onUpload(collection.id)}
                          style={{ width: 24, height: 24, minWidth: 24 }}
                        />
                      </Tooltip>
                      <Dropdown
                        menu={{
                          items: [
                            { key: 'edit', label: '编辑', icon: <EditOutlined /> },
                            { type: 'divider' },
                            {
                              key: 'delete',
                              label: '删除',
                              icon: <DeleteOutlined />,
                              danger: true
                            }
                          ],
                          onClick: ({ key }) => {
                            if (key === 'edit') onEditCollection(collection)
                            if (key === 'delete') onDeleteCollection(collection.id)
                          }
                        }}
                        trigger={['click']}
                      >
                        <Button
                          type="text"
                          size="small"
                          icon={<MoreOutlined style={{ fontSize: 12 }} />}
                          style={{ width: 24, height: 24, minWidth: 24 }}
                        />
                      </Dropdown>
                    </div>
                  </div>
                </div>
              )
            })
          ) : (
            <div className="flex flex-col items-center justify-center h-full py-12">
              <div
                className="w-16 h-16 rounded-2xl flex items-center justify-center mb-4"
                style={{ background: token.colorFillSecondary }}
              >
                <BookOutlined style={{ fontSize: 28, color: token.colorTextQuaternary }} />
              </div>
              <Typography.Text type="secondary" className="text-center text-sm">
                {collectionQuery ? '未找到匹配的文档集' : '暂无文档集'}
              </Typography.Text>
              {!collectionQuery && (
                <Button
                  type="link"
                  size="small"
                  onClick={onCreateCollection}
                  className="mt-2"
                >
                  立即创建
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 底部支持格式提示 */}
        <div
          className="px-4 py-3"
          style={{
            borderTop: `1px solid ${token.colorBorderSecondary}`,
            background: token.colorFillQuaternary
          }}
        >
          <div className="flex items-center justify-center gap-2">
            <div className="flex -space-x-1">
              <div
                className="w-5 h-5 rounded flex items-center justify-center"
                style={{ background: 'rgba(255, 77, 79, 0.1)' }}
              >
                <FilePdfOutlined style={{ fontSize: 10, color: '#ff4d4f' }} />
              </div>
              <div
                className="w-5 h-5 rounded flex items-center justify-center"
                style={{ background: 'rgba(24, 144, 255, 0.1)' }}
              >
                <FileWordOutlined style={{ fontSize: 10, color: '#1890ff' }} />
              </div>
              <div
                className="w-5 h-5 rounded flex items-center justify-center"
                style={{ background: 'rgba(19, 194, 194, 0.1)' }}
              >
                <FileMarkdownOutlined style={{ fontSize: 10, color: '#13c2c2' }} />
              </div>
              <div
                className="w-5 h-5 rounded flex items-center justify-center"
                style={{ background: 'rgba(79, 70, 229, 0.1)' }}
              >
                <GlobalOutlined style={{ fontSize: 10, color: '#4f46e5' }} />
              </div>
            </div>
            <Typography.Text type="secondary" className="text-xs">
              支持文档和网页
            </Typography.Text>
          </div>
        </div>
      </aside>

      {/* ========== 右栏：文档详情视图 ========== */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {activeCollection ? (
          <>
            {/* 头部工具栏 */}
            <div
              className="px-6 py-4"
              style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
            >
              {/* 文档集名称 */}
              <Flex align="center" gap={12} className="mb-4">
                <Typography.Title level={4} style={{ margin: 0 }}>
                  {activeCollection.name}
                </Typography.Title>
                <Tooltip title="编辑文档集">
                  <Button
                    type="text"
                    size="small"
                    icon={<EditOutlined />}
                    onClick={() => onEditCollection(activeCollection)}
                  />
                </Tooltip>
                <Typography.Text type="secondary" className="ml-auto">
                  {collectionFiles.length} 个文档
                </Typography.Text>
              </Flex>

              {/* 操作栏 */}
              <Flex gap={12} align="center">
                <Button
                  type="primary"
                  icon={<UploadOutlined />}
                  onClick={() => onUpload(activeCollection.id)}
                >
                  导入文件
                </Button>
                <Button
                  icon={<LinkOutlined />}
                  onClick={() => handleOpenUrlModal(activeCollection.id)}
                >
                  从 URL 导入
                </Button>

                <div className="flex-1" />

                <Input
                  placeholder="搜索文档..."
                  allowClear
                  prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
                  value={docQuery}
                  onChange={(e) => setDocQuery(e.target.value)}
                  style={{ width: 200, borderRadius: 8 }}
                  variant="filled"
                />

                <Segmented
                  size="small"
                  value={sortKey}
                  onChange={(val) => setSortKey(val as typeof sortKey)}
                  options={[
                    { label: '最近', value: 'updatedAt' },
                    { label: '名称', value: 'name' },
                    { label: '分块', value: 'chunkCount' }
                  ]}
                />

                <Segmented
                  size="small"
                  value={viewMode}
                  onChange={(val) => setViewMode(val as typeof viewMode)}
                  options={[
                    { label: <AppstoreOutlined />, value: 'grid' },
                    { label: <UnorderedListOutlined />, value: 'list' }
                  ]}
                />
              </Flex>
            </div>

            {/* 文档列表 */}
            <div className="flex-1 overflow-y-auto p-6">
              {displayedFiles.length > 0 ? (
                viewMode === 'grid' ? (
                  // 网格视图
                  <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
                    {displayedFiles.map((file) => {
                      const statusInfo = statusConfig[file.status]
                      const fileInfo = getFileIconInfo(file.name, file.sourceType, file.path)
                      const isSelected = activeDocument === file.path

                      return (
                        <div
                          key={file.path}
                          className="group relative rounded-xl p-4 cursor-pointer transition-all duration-200 hover:shadow-lg"
                          onClick={() => onUpdateActiveDocument(file.path)}
                          style={{
                            background: isSelected
                              ? token.colorPrimaryBg
                              : token.colorBgElevated,
                            border: isSelected
                              ? `2px solid ${token.colorPrimary}`
                              : `1px solid ${token.colorBorderSecondary}`
                          }}
                        >
                          {/* 文件图标 */}
                          <div
                            className="w-12 h-12 rounded-xl flex items-center justify-center mb-3"
                            style={{
                              background: fileInfo.bgColor,
                              color: fileInfo.color,
                              fontSize: 24
                            }}
                          >
                            {fileInfo.icon}
                          </div>

                          {/* 文件名 */}
                          <Typography.Text
                            className="block truncate font-medium text-sm mb-2"
                            title={file.name}
                          >
                            {file.name}
                          </Typography.Text>

                          {/* 状态和分块 */}
                          <Flex align="center" gap={8}>
                            <Tag
                              icon={statusInfo.icon}
                              color={statusInfo.color}
                              style={{
                                margin: 0,
                                fontSize: 10,
                                padding: '0 6px',
                                borderRadius: 4
                              }}
                            >
                              {statusInfo.text}
                            </Tag>
                            {file.status === 'ready' && (
                              <Typography.Text type="secondary" className="text-xs">
                                {file.chunkCount ?? 0} 分块
                              </Typography.Text>
                            )}
                          </Flex>

                          {/* 悬停操作 */}
                          <div
                            className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Tooltip title="重新索引">
                              <Button
                                type="text"
                                size="small"
                                icon={<ReloadOutlined style={{ fontSize: 12 }} />}
                                onClick={() => onReindexDocument(file.path)}
                                style={{
                                  width: 24,
                                  height: 24,
                                  minWidth: 24,
                                  background: token.colorBgElevated
                                }}
                              />
                            </Tooltip>
                            <Popconfirm
                              title="确认移除文档？"
                              description="移除后需要重新导入"
                              okText="移除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              onConfirm={() => onRemoveDocument(file.path)}
                            >
                              <Tooltip title="移除">
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                                  style={{
                                    width: 24,
                                    height: 24,
                                    minWidth: 24,
                                    background: token.colorBgElevated
                                  }}
                                />
                              </Tooltip>
                            </Popconfirm>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                ) : (
                  // 列表视图
                  <div className="space-y-2">
                    {displayedFiles.map((file) => {
                      const statusInfo = statusConfig[file.status]
                      const fileInfo = getFileIconInfo(file.name, file.sourceType, file.path)
                      const isSelected = activeDocument === file.path

                      return (
                        <div
                          key={file.path}
                          className="group flex items-center gap-4 rounded-xl p-3 cursor-pointer transition-all duration-200 hover:shadow-md"
                          onClick={() => onUpdateActiveDocument(file.path)}
                          style={{
                            background: isSelected
                              ? token.colorPrimaryBg
                              : token.colorBgElevated,
                            border: isSelected
                              ? `2px solid ${token.colorPrimary}`
                              : `1px solid ${token.colorBorderSecondary}`
                          }}
                        >
                          {/* 文件图标 */}
                          <div
                            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                            style={{
                              background: fileInfo.bgColor,
                              color: fileInfo.color
                            }}
                          >
                            {fileInfo.icon}
                          </div>

                          {/* 文件信息 */}
                          <div className="flex-1 min-w-0">
                            <Typography.Text className="block truncate font-medium text-sm">
                              {file.name}
                            </Typography.Text>
                          </div>

                          {/* 状态 */}
                          <Tag
                            icon={statusInfo.icon}
                            color={statusInfo.color}
                            style={{ margin: 0, fontSize: 10, padding: '0 6px', borderRadius: 4 }}
                          >
                            {statusInfo.text}
                          </Tag>

                          {/* 分块数 */}
                          {file.status === 'ready' && (
                            <Typography.Text
                              type="secondary"
                              className="text-xs w-16 text-right"
                            >
                              {file.chunkCount ?? 0} 分块
                            </Typography.Text>
                          )}

                          {/* 操作按钮 */}
                          <div
                            className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Tooltip title="重新索引">
                              <Button
                                type="text"
                                size="small"
                                icon={<ReloadOutlined style={{ fontSize: 12 }} />}
                                onClick={() => onReindexDocument(file.path)}
                                style={{ width: 26, height: 26, minWidth: 26 }}
                              />
                            </Tooltip>
                            <Popconfirm
                              title="确认移除文档？"
                              description="移除后需要重新导入"
                              okText="移除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              onConfirm={() => onRemoveDocument(file.path)}
                            >
                              <Tooltip title="移除">
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                                  style={{ width: 26, height: 26, minWidth: 26 }}
                                />
                              </Tooltip>
                            </Popconfirm>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              ) : (
                // 空状态 - 拖拽上传区
                <div
                  className="flex flex-col items-center justify-center h-full rounded-2xl border-2 border-dashed cursor-pointer transition-all hover:border-primary/50 hover:bg-primary/5"
                  style={{ borderColor: token.colorBorder }}
                  onClick={() => onUpload(activeCollection.id)}
                >
                  <InboxOutlined
                    style={{ fontSize: 48, color: token.colorTextQuaternary, marginBottom: 16 }}
                  />
                  <Typography.Text type="secondary" className="text-base mb-2">
                    {docQuery ? '未找到匹配的文档' : '拖拽文件到此处，或点击上传'}
                  </Typography.Text>
                  {!docQuery && (
                    <Typography.Text type="secondary" className="text-xs">
                      支持 PDF、Word、TXT、Markdown 等格式
                    </Typography.Text>
                  )}
                </div>
              )}
            </div>
          </>
        ) : (
          // 未选择文档集
          <div className="flex-1 flex flex-col items-center justify-center">
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                <Typography.Text type="secondary">
                  {collections.length > 0 ? '请选择一个文档集查看详情' : '创建文档集开始管理您的知识库'}
                </Typography.Text>
              }
            >
              {collections.length === 0 && (
                <Button type="primary" icon={<PlusOutlined />} onClick={onCreateCollection}>
                  创建文档集
                </Button>
              )}
            </Empty>
          </div>
        )}
      </main>

      {/* URL 导入模态框 */}
      <Modal
        title={
          <div className="flex items-center gap-2">
            <GlobalOutlined style={{ color: token.colorPrimary }} />
            <span>从 URL 导入内容</span>
          </div>
        }
        open={urlModalOpen}
        onCancel={() => setUrlModalOpen(false)}
        onOk={handleAddUrl}
        okText="导入"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="py-4">
          <Typography.Text type="secondary" className="block mb-3">
            输入网页 URL，系统将自动抓取页面内容并添加到知识库
          </Typography.Text>
          <Input
            placeholder="https://example.com/article"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onPressEnter={handleAddUrl}
            prefix={<LinkOutlined style={{ color: token.colorTextQuaternary }} />}
            size="large"
            autoFocus
          />
          <Typography.Text type="secondary" className="block mt-2 text-xs">
            支持大多数 HTML 网页，会自动提取正文内容
          </Typography.Text>
        </div>
      </Modal>
    </div>
  )
}

export default AppSidebar
