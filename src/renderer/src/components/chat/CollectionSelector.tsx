import type { ReactElement } from 'react'
import { PlusOutlined, FolderOpenOutlined, DatabaseOutlined, SearchOutlined } from '@ant-design/icons'
import { Button, Typography, theme as antdTheme, Input, Tooltip } from 'antd'
import type { DocumentCollection } from '../../types/files'
import { useState } from 'react'

interface CollectionSelectorProps {
  collections: DocumentCollection[]
  activeCollectionId?: string
  onCollectionChange: (id: string) => void
  onCreateCollection: () => void
}

export function CollectionSelector({
  collections,
  activeCollectionId,
  onCollectionChange,
  onCreateCollection
}: CollectionSelectorProps): ReactElement {
  const { token } = antdTheme.useToken()
  const [searchValue, setSearchValue] = useState('')

  const filteredCollections = collections.filter(c => 
    c.name.toLowerCase().includes(searchValue.toLowerCase())
  )

  return (
    <div
      className="flex flex-col h-full w-64 bg-gray-50/50 dark:bg-gray-900/20"
      style={{
        borderRight: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {/* Header */}
      <div className="px-3 pt-4 pb-2">
        <div className="flex items-center justify-between mb-3 px-1">
          <Typography.Text className="font-semibold text-sm text-gray-500">
            知识库
          </Typography.Text>
          <Tooltip title="新建知识库">
            <Button
              type="text"
              size="small"
              icon={<PlusOutlined />}
              onClick={onCreateCollection}
              className="text-gray-500 hover:text-primary hover:bg-primary/10"
            />
          </Tooltip>
        </div>
        
        <Input
          placeholder="搜索..."
          prefix={<SearchOutlined className="text-gray-400" />}
          variant="filled"
          size="small"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          className="rounded-lg bg-gray-100 dark:bg-gray-800 border-none hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
        />
      </div>

      {/* Collection List */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-0.5">
        {filteredCollections.map((collection) => {
          const isActive = collection.id === activeCollectionId
          return (
            <div
              key={collection.id}
              onClick={() => onCollectionChange(collection.id)}
              className={`
                group flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-all duration-200
                relative overflow-hidden
              `}
              style={{
                background: isActive ? token.colorFillSecondary : 'transparent'
              }}
            >
              {/* Active Indicator Strip */}
              {isActive && (
                <div 
                  className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 rounded-r-full"
                  style={{ background: token.colorPrimary }}
                />
              )}

              <div
                className={`
                  flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center transition-colors
                  ${isActive ? 'bg-primary/10 text-primary' : 'bg-gray-200/50 text-gray-500 group-hover:bg-gray-200 group-hover:text-gray-700 dark:bg-gray-800 dark:text-gray-400'}
                `}
                style={{
                  color: isActive ? token.colorPrimary : undefined,
                  background: isActive ? token.colorPrimaryBg : undefined
                }}
              >
                <FolderOpenOutlined />
              </div>
              
              <div className="flex flex-col min-w-0 flex-1">
                <Typography.Text
                  className={`font-medium truncate text-sm transition-colors ${isActive ? 'text-primary' : 'text-gray-700 dark:text-gray-300'}`}
                  style={{
                    color: isActive ? token.colorPrimary : undefined
                  }}
                >
                  {collection.name}
                </Typography.Text>
                <Typography.Text type="secondary" className="text-xs truncate opacity-80">
                  {collection.files.length} 文档
                </Typography.Text>
              </div>
            </div>
          )
        })}

        {collections.length === 0 && (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4 opacity-60">
            <DatabaseOutlined style={{ fontSize: 24, color: token.colorTextQuaternary, marginBottom: 8 }} />
            <Typography.Text type="secondary" className="text-xs">
              暂无知识库
            </Typography.Text>
            <Button 
              type="link" 
              size="small" 
              onClick={onCreateCollection}
              className="mt-2"
            >
              立即创建
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}

