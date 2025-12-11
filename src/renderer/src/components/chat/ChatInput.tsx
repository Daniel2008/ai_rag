import type { ReactElement } from 'react'
import { useMemo, useState, useCallback } from 'react'
import { Sender } from '@ant-design/x'
import { Divider, Select, Tag, Typography, theme as antdTheme } from 'antd'
import { ThunderboltOutlined } from '@ant-design/icons'
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
  collections: DocumentCollection[]
  resolvedCollectionId: string | undefined
  showQuickQuestions: boolean
  /** 是否有可用文件（用于启用"当前文档"选项） */
  hasReadyFiles: boolean
  readyFiles: IndexedFile[]
  onMentionFilesChange: (mentions: { token: string; path: string }[]) => void
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
  collections,
  resolvedCollectionId,
  showQuickQuestions,
  hasReadyFiles,
  readyFiles,
  onMentionFilesChange,
  onInputChange,
  onSubmit,
  onQuestionScopeChange,
  onCollectionChange,
  onStopGeneration,
  onPromptClick
}: ChatInputProps): ReactElement {
  const { token } = antdTheme.useToken()
  const [mentionVisible, setMentionVisible] = useState(false)
  const [mentionKeyword, setMentionKeyword] = useState('')
  const [mentioned, setMentioned] = useState<{ token: string; path: string }[]>([])

  const filteredMentionOptions = useMemo(
    () =>
      readyFiles
        .filter((f) => f.name.toLowerCase().includes(mentionKeyword.toLowerCase()))
        .slice(0, 8),
    [readyFiles, mentionKeyword]
  )

  const handleChange = useCallback(
    (val: string) => {
      onInputChange(val)
      const remaining = mentioned.filter((m) => val.includes(m.token))
      if (remaining.length !== mentioned.length) {
        setMentioned(remaining)
        onMentionFilesChange(remaining)
      }
      const match = /#([^\s#]*)$/.exec(val)
      if (match) {
        setMentionKeyword(match[1] || '')
        setMentionVisible(true)
      } else {
        setMentionKeyword('')
        setMentionVisible(false)
      }
    },
    [mentioned, onInputChange, onMentionFilesChange]
  )

  const handleSelectMention = useCallback(
    (path: string, name: string) => {
      const token = `#${name}`
      const next = inputValue.replace(/#([^\s#]*)$/, `${token} `)
      onInputChange(next)
      const nextMentions = mentioned.some((m) => m.path === path)
        ? mentioned
        : [...mentioned, { token, path }]
      setMentioned(nextMentions)
      onMentionFilesChange(nextMentions)
      setMentionVisible(false)
      setMentionKeyword('')
    },
    [inputValue, mentioned, onInputChange, onMentionFilesChange]
  )

  // Sender 头部操作
  const senderHeader = useMemo(
    () => (
      <div className="flex items-center gap-2 px-2 py-1">
        <Select
          size="small"
          value={questionScope}
          onChange={onQuestionScopeChange}
          options={[
            { label: '🌐 全库检索', value: 'all', disabled: !hasReadyFiles },
            {
              label: '📁 文档集',
              value: 'collection',
              disabled: !hasReadyFiles || collections.length === 0
            }
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
          {questionScope === 'collection'
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
      readyDocuments,
      hasReadyFiles,
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
            onChange={handleChange}
            onSubmit={onSubmit}
            placeholder={
              readyDocuments > 0
                ? '输入问题，输入 # 选择文件（可多选）...'
                : '请先导入文档到知识库...'
            }
            loading={isTyping}
            onCancel={onStopGeneration}
            submitType="enter"
          />
          {mentionVisible && filteredMentionOptions.length > 0 && (
            <div
              className="absolute left-0 right-0 z-50 shadow-lg rounded-md border max-h-60 overflow-auto mt-1"
              // 位于输入框上方，避免靠底部时被裁剪
              style={{
                top: 'auto',
                bottom: '100%',
                marginBottom: 8,
                background: token.colorBgContainer,
                borderColor: token.colorBorderSecondary
              }}
            >
              {filteredMentionOptions.map((opt) => (
                <div
                  key={opt.path}
                  className="px-3 py-2 cursor-pointer hover:bg-gray-100"
                  style={{
                    background: token.colorBgContainer
                  }}
                  onMouseDown={(e) => {
                    e.preventDefault() // 防止失焦关闭弹层
                    handleSelectMention(opt.path, opt.name)
                  }}
                >
                  <div className="font-medium text-sm">{opt.name}</div>
                  <div className="text-xs text-gray-500 truncate">{opt.path}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </footer>
  )
}
