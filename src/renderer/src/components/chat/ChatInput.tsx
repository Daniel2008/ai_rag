import type { ReactElement } from 'react'
import { useMemo } from 'react'
import { Sender } from '@ant-design/x'
import { Button, Divider, Select, Tag, Tooltip, Typography, theme as antdTheme } from 'antd'
import { ThunderboltOutlined, StopOutlined } from '@ant-design/icons'
import type { QuestionScope } from '../../types/chat'
import type { DocumentCollection, IndexedFile } from '../../types/files'
import { QUICK_QUESTIONS } from '../../constants/chat'

interface ChatInputProps {
  themeMode: 'light' | 'dark'
  inputValue: string
  isTyping: boolean
  readyDocuments: number
  questionScope: QuestionScope
  activeDocument: string | undefined
  activeFile: IndexedFile | undefined
  collections: DocumentCollection[]
  resolvedCollectionId: string | undefined
  showQuickQuestions: boolean
  onInputChange: (value: string) => void
  onSubmit: (value: string) => void
  onQuestionScopeChange: (scope: QuestionScope) => void
  onCollectionChange: (id: string) => void
  onStopGeneration: () => void
  onPromptClick: (content: string) => void
}

export function ChatInput({
  themeMode,
  inputValue,
  isTyping,
  readyDocuments,
  questionScope,
  activeDocument,
  activeFile,
  collections,
  resolvedCollectionId,
  showQuickQuestions,
  onInputChange,
  onSubmit,
  onQuestionScopeChange,
  onCollectionChange,
  onStopGeneration,
  onPromptClick
}: ChatInputProps): ReactElement {
  const { token } = antdTheme.useToken()

  // Sender 头部操作
  const senderHeader = useMemo(
    () => (
      <div className="flex items-center gap-2 px-2 py-1">
        <Select
          size="small"
          value={questionScope}
          onChange={onQuestionScopeChange}
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
            onChange={onCollectionChange}
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
    [
      questionScope,
      activeDocument,
      collections,
      resolvedCollectionId,
      activeFile,
      readyDocuments,
      onQuestionScopeChange,
      onCollectionChange
    ]
  )

  return (
    <footer
      className="chat-sender p-4"
      style={{
        background: token.colorBgContainer,
        borderTop: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      <div className="mx-auto max-w-4xl">
        {/* 快捷提问 */}
        {!isTyping && showQuickQuestions && (
          <div className="flex flex-wrap gap-2 mb-3">
            {QUICK_QUESTIONS.slice(0, 3).map((q, i) => (
              <Tag
                key={i}
                className="cursor-pointer card-hover"
                style={{
                  borderRadius: 20,
                  padding: '4px 12px',
                  background:
                    themeMode === 'dark' ? 'rgba(129, 140, 248, 0.1)' : 'rgba(79, 70, 229, 0.05)',
                  border: `1px solid ${themeMode === 'dark' ? 'rgba(129, 140, 248, 0.2)' : 'rgba(79, 70, 229, 0.1)'}`,
                  color: token.colorPrimary
                }}
                onClick={() => onPromptClick(q)}
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
            onChange={onInputChange}
            onSubmit={onSubmit}
            placeholder={
              readyDocuments > 0
                ? '输入您的问题，我将从知识库中为您找到答案...'
                : '请先导入文档到知识库...'
            }
            loading={isTyping}
            onCancel={onStopGeneration}
            submitType="enter"
          />
        </div>
      </div>
    </footer>
  )
}
