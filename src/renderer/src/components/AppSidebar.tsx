import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  DownOutlined,
  UpOutlined,
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
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
  BookOutlined
} from '@ant-design/icons'
import {
  Button,
  Popconfirm,
  Tag,
  theme as antdTheme,
  Input,
  Segmented,
  Tooltip,
  Collapse,
  Dropdown,
  Typography,
  Flex,
  Progress
} from 'antd'
import type { DocumentCollection, IndexedFile } from '../types/files'
import type { ProcessProgress } from '../hooks/useKnowledgeBase'

interface AppSidebarProps {
  collections: DocumentCollection[]
  activeCollectionId?: string
  activeDocument?: string
  files: IndexedFile[]
  /** 文档处理进度 */
  processProgress?: ProcessProgress | null
  onCollectionChange: (key: string) => void
  onCreateCollection: () => void
  onEditCollection: (collection: DocumentCollection) => void
  onDeleteCollection: (collectionId: string) => void
  onUpload: (targetCollectionId: string) => void
  onUpdateActiveDocument: (path?: string) => void
  onReindexDocument: (filePath: string) => void
  onRemoveDocument: (filePath: string) => void
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

// 根据文件名获取图标和颜色
function getFileIconInfo(fileName: string): { icon: ReactElement; color: string; bgColor: string } {
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
        color: '#722ed1',
        bgColor: 'rgba(114, 46, 209, 0.1)'
      }
    case 'md':
    case 'markdown':
      return {
        icon: <FileMarkdownOutlined />,
        color: '#13c2c2',
        bgColor: 'rgba(19, 194, 194, 0.1)'
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
  processProgress,
  onCollectionChange,
  onCreateCollection,
  onEditCollection,
  onDeleteCollection,
  onUpload,
  onUpdateActiveDocument,
  onReindexDocument,
  onRemoveDocument
}: AppSidebarProps): ReactElement {
  const { token } = antdTheme.useToken()
  const panelActiveKey =
    activeCollectionId && collections.some((c) => c.id === activeCollectionId)
      ? activeCollectionId
      : undefined

  // 稳定 activeKey 数组引用，避免 Collapse 无限循环
  const collapseActiveKey = useMemo(
    () => (panelActiveKey ? [panelActiveKey] : []),
    [panelActiveKey]
  )

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === panelActiveKey),
    [collections, panelActiveKey]
  )

  const collectionFiles = useMemo(
    () =>
      activeCollection ? files.filter((file) => activeCollection.files.includes(file.path)) : [],
    [activeCollection, files]
  )

  const [collectionQuery, setCollectionQuery] = useState('')
  const [isExpanded, setIsExpanded] = useState(false)
  const DEFAULT_VISIBLE_COUNT = 5

  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<'updatedAt' | 'name' | 'chunkCount'>('updatedAt')

  const filteredCollections = useMemo(() => {
    if (!collectionQuery.trim()) return collections
    return collections.filter((c) =>
      c.name.toLowerCase().includes(collectionQuery.trim().toLowerCase())
    )
  }, [collections, collectionQuery])

  const visibleCollections = useMemo(() => {
    if (collectionQuery.trim()) return filteredCollections
    if (isExpanded) return filteredCollections
    return filteredCollections.slice(0, DEFAULT_VISIBLE_COUNT)
  }, [filteredCollections, isExpanded, collectionQuery])

  const displayedFiles = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    const filtered = keyword
      ? collectionFiles.filter((f) => f.name.toLowerCase().includes(keyword))
      : collectionFiles
    const sorted = [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name)
      if (sortKey === 'chunkCount') return (b.chunkCount ?? 0) - (a.chunkCount ?? 0)
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0)
    })
    return sorted
  }, [collectionFiles, query, sortKey])

  // 统计信息
  const totalFiles = files.length

  const collapseItems = useMemo(
    () =>
      visibleCollections.map((collection) => {
        const isActive = collection.id === panelActiveKey
        return {
          key: collection.id,
          label: (
            <div className="flex items-center justify-between w-full">
              <div className="flex items-center overflow-hidden gap-3" title={collection.name}>
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200"
                  style={{
                    background: isActive
                      ? `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`
                      : token.colorFillSecondary,
                    boxShadow: isActive ? '0 4px 12px rgba(79, 70, 229, 0.3)' : 'none'
                  }}
                >
                  <FolderOpenOutlined
                    style={{
                      fontSize: 18,
                      color: isActive ? '#fff' : token.colorTextSecondary
                    }}
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <Typography.Text
                    className="truncate font-semibold text-sm"
                    style={{ color: isActive ? token.colorPrimary : token.colorText }}
                  >
                    {collection.name}
                  </Typography.Text>
                  <Typography.Text type="secondary" className="text-xs">
                    {collection.files.length} 个文档
                  </Typography.Text>
                </div>
              </div>
            </div>
          ),
          extra: (
            <div onClick={(e) => e.stopPropagation()} className="flex items-center gap-1">
              <Tooltip title="导入文件">
                <Button
                  type="text"
                  size="small"
                  icon={<UploadOutlined />}
                  onClick={() => onUpload(collection.id)}
                  className="hover:bg-primary/10"
                  style={{ color: token.colorPrimary }}
                />
              </Tooltip>
              <Dropdown
                menu={{
                  items: [
                    {
                      key: 'edit',
                      label: '编辑文档集',
                      icon: <EditOutlined />
                    },
                    { type: 'divider' },
                    {
                      key: 'delete',
                      label: '删除文档集',
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
                <Button type="text" size="small" icon={<MoreOutlined />} />
              </Dropdown>
            </div>
          ),
          children: (
            <div className="flex flex-col gap-3 pt-2">
              {/* 搜索和排序 */}
              <div className="flex flex-col gap-2">
                <Input
                  allowClear
                  size="small"
                  placeholder="搜索文档..."
                  prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  style={{
                    borderRadius: 8,
                    background: token.colorFillQuaternary
                  }}
                  variant="filled"
                />
                <Segmented
                  block
                  size="small"
                  value={sortKey}
                  onChange={(val) => setSortKey(val as typeof sortKey)}
                  options={[
                    { label: '最近', value: 'updatedAt' },
                    { label: '名称', value: 'name' },
                    { label: '分块', value: 'chunkCount' }
                  ]}
                  style={{ borderRadius: 8 }}
                />
              </div>

              {/* 文档列表 */}
              {displayedFiles.length ? (
                <div className="flex flex-col gap-2">
                  {displayedFiles.map((file) => {
                    const statusInfo = statusConfig[file.status]
                    const fileInfo = getFileIconInfo(file.name)
                    const isSelected = activeDocument === file.path

                    return (
                      <div
                        key={file.path}
                        className="group relative rounded-xl p-3 cursor-pointer transition-all duration-200 hover:shadow-md"
                        onClick={() => onUpdateActiveDocument(file.path)}
                        style={{
                          background: isSelected
                            ? `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, rgba(124, 58, 237, 0.05) 100%)`
                            : token.colorFillQuaternary,
                          border: isSelected
                            ? `2px solid ${token.colorPrimary}`
                            : '2px solid transparent'
                        }}
                      >
                        <div className="flex items-start gap-3">
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
                            <Typography.Text
                              className="block truncate font-medium text-sm mb-1"
                              title={file.name}
                              style={{
                                color: isSelected ? token.colorPrimary : token.colorText
                              }}
                            >
                              {file.name}
                            </Typography.Text>
                            <div className="flex items-center gap-2">
                              <Tag
                                icon={statusInfo.icon}
                                color={statusInfo.color}
                                bordered={false}
                                style={{
                                  margin: 0,
                                  fontSize: 10,
                                  padding: '0 6px',
                                  borderRadius: 4,
                                  lineHeight: '18px'
                                }}
                              >
                                {statusInfo.text}
                              </Tag>
                              {file.status === 'ready' && (
                                <Typography.Text type="secondary" className="text-xs">
                                  {file.chunkCount ?? 0} 分块
                                </Typography.Text>
                              )}
                            </div>
                          </div>

                          {/* 操作按钮 */}
                          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Tooltip title="重新索引" placement="top">
                              <Button
                                type="text"
                                size="small"
                                icon={<ReloadOutlined style={{ fontSize: 12 }} />}
                                onClick={(e) => {
                                  e.stopPropagation()
                                  onReindexDocument(file.path)
                                }}
                                style={{ width: 26, height: 26, minWidth: 26 }}
                              />
                            </Tooltip>
                            <Popconfirm
                              title="确认移除文档？"
                              description="移除后需要重新导入"
                              okText="移除"
                              cancelText="取消"
                              okButtonProps={{ danger: true }}
                              onConfirm={(e) => {
                                e?.stopPropagation()
                                onRemoveDocument(file.path)
                              }}
                              onCancel={(e) => e?.stopPropagation()}
                            >
                              <Tooltip title="移除" placement="top">
                                <Button
                                  type="text"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined style={{ fontSize: 12 }} />}
                                  onClick={(e) => e.stopPropagation()}
                                  style={{ width: 26, height: 26, minWidth: 26 }}
                                />
                              </Tooltip>
                            </Popconfirm>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div
                  className="flex flex-col items-center justify-center py-8 rounded-xl border-2 border-dashed cursor-pointer transition-all hover:border-primary/50 hover:bg-primary/5"
                  style={{ borderColor: token.colorBorder }}
                  onClick={() => onUpload(collection.id)}
                >
                  <InboxOutlined
                    style={{ fontSize: 32, color: token.colorTextQuaternary, marginBottom: 8 }}
                  />
                  <Typography.Text type="secondary" className="text-sm">
                    {query ? '未找到匹配文档' : '点击或拖拽文件到此处'}
                  </Typography.Text>
                  {!query && (
                    <Typography.Text type="secondary" className="text-xs mt-1">
                      支持 PDF、Word、TXT、Markdown
                    </Typography.Text>
                  )}
                </div>
              )}
            </div>
          )
        }
      }),
    [
      visibleCollections,
      panelActiveKey,
      displayedFiles,
      query,
      sortKey,
      token,
      activeDocument,
      onUpload,
      onEditCollection,
      onDeleteCollection,
      onUpdateActiveDocument,
      onReindexDocument,
      onRemoveDocument
    ]
  )

  return (
    <aside
      className="flex w-80 flex-col"
      style={{
        background: token.colorBgContainer,
        borderLeft: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {/* 头部 */}
      <div
        className="px-4 pt-5 pb-4"
        style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      >
        <Flex align="center" justify="space-between" className="mb-4">
          <Flex align="center" gap={12}>
            <div
              className="w-11 h-11 rounded-xl flex items-center justify-center"
              style={{
                background: `linear-gradient(135deg, ${token.colorSuccess} 0%, #059669 100%)`,
                boxShadow: '0 4px 12px rgba(16, 185, 129, 0.3)'
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
          <Tooltip title="新建文档集">
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={onCreateCollection}
              style={{
                background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
                border: 'none',
                borderRadius: 10,
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
              }}
            />
          </Tooltip>
        </Flex>

        {/* 搜索框 */}
        <Input
          placeholder="搜索文档集..."
          allowClear
          prefix={<SearchOutlined style={{ color: token.colorTextQuaternary }} />}
          value={collectionQuery}
          onChange={(e) => setCollectionQuery(e.target.value)}
          className="mt-5"
          style={{ borderRadius: 10 }}
          variant="filled"
        />

        {/* 导入进度条 */}
        {processProgress && (
          <div
            className="mt-4 p-3 rounded-xl"
            style={{
              background: processProgress.error
                ? 'rgba(255, 77, 79, 0.1)'
                : `linear-gradient(135deg, ${token.colorPrimaryBg} 0%, rgba(124, 58, 237, 0.05) 100%)`,
              border: `1px solid ${processProgress.error ? token.colorError : token.colorPrimaryBorder}`
            }}
          >
            <div className="flex items-center justify-between mb-2">
              <Typography.Text
                className="text-xs font-medium"
                style={{ color: processProgress.error ? token.colorError : token.colorPrimary }}
              >
                {processProgress.error ? '导入失败' : '正在导入文档'}
              </Typography.Text>
              <Typography.Text
                className="text-xs"
                style={{ color: processProgress.error ? token.colorError : token.colorPrimary }}
              >
                {processProgress.percent}%
              </Typography.Text>
            </div>
            <Progress
              percent={processProgress.percent}
              size="small"
              showInfo={false}
              status={processProgress.error ? 'exception' : 'active'}
              strokeColor={
                processProgress.error
                  ? token.colorError
                  : {
                      '0%': token.colorPrimary,
                      '100%': '#7c3aed'
                    }
              }
            />
            <Typography.Text type="secondary" className="text-xs mt-1 block">
              {processProgress.stage}
            </Typography.Text>
          </div>
        )}
      </div>

      {/* 文档集列表 */}
      <div className="flex-1 overflow-y-auto px-3 py-3">
        {collections.length > 0 ? (
          <>
            <Collapse
              accordion
              ghost
              activeKey={collapseActiveKey}
              onChange={(key) => {
                const newKey = Array.isArray(key) ? key[0] : key
                onCollectionChange(newKey ? String(newKey) : '')
              }}
              items={collapseItems}
              expandIconPosition="end"
              className="knowledge-collapse"
            />
            {!collectionQuery.trim() && collections.length > DEFAULT_VISIBLE_COUNT && (
              <Button
                type="text"
                size="small"
                icon={isExpanded ? <UpOutlined /> : <DownOutlined />}
                className="mt-2 w-full"
                style={{ color: token.colorTextSecondary }}
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? '收起' : `展开更多 (${collections.length - DEFAULT_VISIBLE_COUNT})`}
              </Button>
            )}
          </>
        ) : (
          <div className="flex flex-col items-center justify-center h-full">
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center mb-4"
              style={{
                background: token.colorFillSecondary
              }}
            >
              <BookOutlined style={{ fontSize: 36, color: token.colorTextQuaternary }} />
            </div>
            <Typography.Title level={5} type="secondary" style={{ marginBottom: 4 }}>
              知识库为空
            </Typography.Title>
            <Typography.Text type="secondary" className="text-center mb-6 px-4 text-sm">
              创建文档集，导入文件构建您的智能知识库
            </Typography.Text>
            <Button
              type="primary"
              icon={<PlusOutlined />}
              size="large"
              onClick={onCreateCollection}
              style={{
                background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
                border: 'none',
                borderRadius: 12,
                height: 44,
                paddingInline: 28,
                boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
              }}
            >
              创建文档集
            </Button>
          </div>
        )}
      </div>

      {/* 底部提示 */}
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
          </div>
          <Typography.Text type="secondary" className="text-xs">
            支持多种文档格式
          </Typography.Text>
        </div>
      </div>
    </aside>
  )
}

export default AppSidebar
