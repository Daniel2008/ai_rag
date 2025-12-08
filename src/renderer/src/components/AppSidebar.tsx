import { useMemo } from 'react'
import type { ReactElement } from 'react'
import {
  Actions,
  Conversations,
  type ConversationItemType,
  Welcome
} from '@ant-design/x'
import {
  DeleteOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  ReloadOutlined,
  UploadOutlined
} from '@ant-design/icons'
import { Button, Card, Popconfirm, Space, Tag } from 'antd'
import type { DocumentCollection, IndexedFile } from '../types/files'

interface AppSidebarProps {
  collections: DocumentCollection[]
  activeCollectionId?: string
  activeDocument?: string
  files: IndexedFile[]
  onCollectionChange: (key: string) => void
  onCreateCollection: () => void
  onEditCollection: (collection: DocumentCollection) => void
  onDeleteCollection: (collectionId: string) => void
  onUpload: (targetCollectionId: string) => void
  onUpdateActiveDocument: (path?: string) => void
  onReindexDocument: (filePath: string) => void
  onRemoveDocument: (filePath: string) => void
}

const statusText: Record<IndexedFile['status'], string> = {
  processing: '索引中',
  ready: '已就绪',
  error: '失败'
}

const statusColor: Record<IndexedFile['status'], string> = {
  processing: 'processing',
  ready: 'success',
  error: 'error'
}

export function AppSidebar({
  collections,
  activeCollectionId,
  activeDocument,
  files,
  onCollectionChange,
  onCreateCollection,
  onEditCollection,
  onDeleteCollection,
  onUpload,
  onUpdateActiveDocument,
  onReindexDocument,
  onRemoveDocument
}: AppSidebarProps): ReactElement {
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

  const activeCollection = useMemo(
    () => collections.find((collection) => collection.id === resolvedCollectionId),
    [collections, resolvedCollectionId]
  )

  const collectionFiles = useMemo(
    () =>
      activeCollection ? files.filter((file) => activeCollection.files.includes(file.path)) : [],
    [activeCollection, files]
  )

  const collectionItems: ConversationItemType[] = useMemo(
    () =>
      collections.map((collection) => ({
        key: collection.id,
        label: (
          <div className="conversation-label">
            <div className="conversation-title" title={collection.name}>
              <FolderOpenOutlined style={{ marginRight: 8 }} />
              <span className="conversation-name">{collection.name}</span>
            </div>
            <div className="conversation-meta">
              <Tag color="purple">{collection.files.length} 文档</Tag>
            </div>
          </div>
        )
      })),
    [collections]
  )

  return (
    <aside className="flex w-72 flex-col border-r border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900">
      <div className="p-4 pb-2">
        <div>
          <h2 className="m-0 text-lg font-semibold text-gray-800 dark:text-gray-100">文档集</h2>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {collections.length ? `已创建 ${collections.length} 个文档集` : '尚未创建文档集'}
          </p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 pb-6">
        {collections.length > 0 ? (
          <>
            <Conversations
              items={collectionItems}
              activeKey={resolvedCollectionId}
              onActiveChange={(key) => onCollectionChange(String(key))}
              creation={{
                label: '新建文档集',
                icon: <PlusOutlined />,
                onClick: onCreateCollection
              }}
            />
            {activeCollection ? (
              <Card
                size="small"
                className="mt-4 bg-gray-50 dark:bg-gray-800"
                title={activeCollection.name}
                bordered={false}
                extra={
                  <Space size="small" wrap>
                    <Button
                      type="primary"
                      size="small"
                      icon={<UploadOutlined />}
                      onClick={() => onUpload(activeCollection.id)}
                    >
                      导入
                    </Button>
                    <Button
                      type="link"
                      size="small"
                      icon={<EditOutlined />}
                      onClick={() => onEditCollection(activeCollection)}
                    />
                    <Popconfirm
                      title="删除文档集"
                      description="该文档集将被移除，确认继续？"
                      okText="删除"
                      cancelText="取消"
                      okButtonProps={{ danger: true }}
                      onConfirm={() => onDeleteCollection(activeCollection.id)}
                    >
                      <Button type="link" size="small" danger icon={<DeleteOutlined />} />
                    </Popconfirm>
                  </Space>
                }
              >
                <Space size="small" wrap className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                  <Tag color="blue">{activeCollection.files.length} 个文档</Tag>
                  {activeCollection.description ? (
                    <span className="text-gray-500 dark:text-gray-400">
                      {activeCollection.description}
                    </span>
                  ) : null}
                </Space>
                {collectionFiles.length ? (
                  <div className="flex flex-col gap-3">
                    {collectionFiles.map((file) => (
                      <div
                        key={file.path}
                        className={`cursor-pointer rounded-lg border p-3 transition-all hover:border-blue-300 hover:shadow-sm dark:border-gray-600 dark:hover:border-blue-500 ${
                          activeDocument === file.path
                            ? 'border-blue-500 shadow-md dark:border-blue-400'
                            : 'border-gray-200 dark:border-gray-700'
                        }`}
                        onClick={() => onUpdateActiveDocument(file.path)}
                      >
                        <div className="mb-1.5 flex items-center justify-between">
                          <div
                            className="flex items-center gap-1.5 font-semibold text-gray-800 dark:text-gray-200"
                            title={file.path}
                          >
                            <FileTextOutlined />
                            <span className="truncate">{file.name}</span>
                          </div>
                          <Tag color={statusColor[file.status]}>{statusText[file.status]}</Tag>
                        </div>
                        <div className="mb-1.5 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                          <Space size="small" wrap>
                            {file.chunkCount ? <span>{file.chunkCount} chunks</span> : null}
                            <Space size="small">
                              <Button
                                type="link"
                                size="small"
                                icon={<ReloadOutlined />}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  onReindexDocument(file.path)
                                }}
                              />
                              <Popconfirm
                                title="移除文档"
                                description="该文档将从知识库与所有文档集中删除，确认继续？"
                                okText="删除"
                                cancelText="取消"
                                okButtonProps={{ danger: true }}
                                onConfirm={() => {
                                  onRemoveDocument(file.path)
                                }}
                              >
                                <Button
                                  type="link"
                                  size="small"
                                  danger
                                  icon={<DeleteOutlined />}
                                  onClick={(event) => event.stopPropagation()}
                                />
                              </Popconfirm>
                            </Space>
                          </Space>
                        </div>
                        <p
                          className={`m-0 text-xs leading-relaxed ${
                            file.preview ? 'text-gray-600 dark:text-gray-300' : 'italic text-gray-400'
                          }`}
                        >
                          {file.preview ?? '暂无预览'}
                        </p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-4 rounded-lg border border-dashed border-gray-300 p-4 text-center text-gray-500 dark:border-gray-600 dark:text-gray-400">
                    <p>该文档集尚未包含文档</p>
                    <Button
                      type="dashed"
                      icon={<UploadOutlined />}
                      onClick={() => onUpload(activeCollection.id)}
                    >
                      导入文档
                    </Button>
                  </div>
                )}
              </Card>
            ) : null}
          </>
        ) : (
          <Welcome
            title="创建文档集开始构建知识库"
            description="先新建文档集，再导入需要索引的 PDF/TXT/Markdown，即可按主题管理知识。"
            extra={
              <Actions
                items={[{ key: 'newCollection', label: '立即创建', icon: <PlusOutlined /> }]}
                onClick={({ key }) => {
                  if (key === 'newCollection') {
                    onCreateCollection()
                  }
                }}
              />
            }
          />
        )}
      </div>
    </aside>
  )
}