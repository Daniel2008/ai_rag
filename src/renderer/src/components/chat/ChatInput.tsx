import type { ReactElement } from 'react'
import { useMemo, useState, useCallback } from 'react'
import { Sender } from '@ant-design/x'
import { Divider, Select, Tag, Typography, theme as antdTheme, Tooltip } from 'antd'
import {
  ThunderboltOutlined,
  FileTextOutlined,
  FolderOutlined,
  GlobalOutlined,
  TagsOutlined
} from '@ant-design/icons'
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
  /** 当前已选择的 # 文件 */
  mentionedFiles: { token: string; path: string }[]
  /** 可用标签 */
  availableTags?: { name: string; count?: number; color?: string }[]
  /** 已选标签 */
  selectedTags?: string[]
  onSelectedTagsChange?: (tags: string[]) => void
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
  mentionedFiles,
  availableTags = [],
  selectedTags = [],
  onSelectedTagsChange,
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
      // 检查已选文件的 token 是否仍在输入中
      const remaining = mentionedFiles.filter((m) => val.includes(m.token))
      if (remaining.length !== mentionedFiles.length) {
        onMentionFilesChange(remaining)
      }
      // 检测 # 触发
      const match = /#([^\s#]*)$/.exec(val)
      if (match) {
        setMentionKeyword(match[1] || '')
        setMentionVisible(true)
      } else {
        setMentionKeyword('')
        setMentionVisible(false)
      }
    },
    [mentionedFiles, onInputChange, onMentionFilesChange]
  )

  const handleSelectMention = useCallback(
    (path: string, name: string) => {
      const mentionToken = `#${name}`
      const next = inputValue.replace(/#([^\s#]*)$/, `${mentionToken} `)
      onInputChange(next)
      // 避免重复添加相同文件
      const nextMentions = mentionedFiles.some((m) => m.path === path)
        ? mentionedFiles
        : [...mentionedFiles, { token: mentionToken, path }]
      onMentionFilesChange(nextMentions)
      setMentionVisible(false)
      setMentionKeyword('')
    },
    [inputValue, mentionedFiles, onInputChange, onMentionFilesChange]
  )

  // 移除已选文件
  const handleRemoveMention = useCallback(
    (path: string) => {
      const toRemove = mentionedFiles.find((m) => m.path === path)
      if (toRemove) {
        // 从输入框中移除对应的 token
        const newInput = inputValue.replace(toRemove.token, '').replace(/\s+/g, ' ').trim()
        onInputChange(newInput)
        onMentionFilesChange(mentionedFiles.filter((m) => m.path !== path))
      }
    },
    [inputValue, mentionedFiles, onInputChange, onMentionFilesChange]
  )

  // 计算当前实际检索范围的描述
  const effectiveSearchScope = useMemo(() => {
    if (mentionedFiles.length > 0) {
      return {
        type: 'mention' as const,
        label: `指定文件 (${mentionedFiles.length})`,
        icon: <FileTextOutlined />,
        files: mentionedFiles.map((m) => {
          const file = readyFiles.find((f) => f.path === m.path)
          return file?.name || m.token.replace('#', '')
        })
      }
    }
    if (questionScope === 'collection' && resolvedCollectionId) {
      const col = collections.find((c) => c.id === resolvedCollectionId)
      return {
        type: 'collection' as const,
        label: col ? `${col.name} (${col.files.length})` : '文档集',
        icon: <FolderOutlined />,
        files: []
      }
    }
    return {
      type: 'all' as const,
      label: `全库 (${readyDocuments})`,
      icon: <GlobalOutlined />,
      files: []
    }
  }, [mentionedFiles, questionScope, resolvedCollectionId, collections, readyDocuments, readyFiles])

  // Sender 头部操作
  const senderHeader = useMemo(
    () => (
      <div className="flex flex-col gap-1 px-2 py-1">
        {/* 检索范围选择 */}
        <div className="flex items-center gap-2">
          <Tooltip title="选择检索范围（输入 # 可指定文件，优先级最高）">
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
          </Tooltip>
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

          {/* 标签过滤选择 */}
          {availableTags.length > 0 && (
            <Tooltip title="按标签筛选检索内容">
              <Select
                mode="multiple"
                size="small"
                placeholder="标签筛选"
                value={selectedTags}
                onChange={onSelectedTagsChange}
                maxTagCount="responsive"
                style={{ minWidth: 100, maxWidth: 240 }}
                variant="borderless"
                options={availableTags.map((t) => ({
                  label: `${t.name} (${t.count || 0})`,
                  value: t.name
                }))}
                suffixIcon={<TagsOutlined />}
              />
            </Tooltip>
          )}

          {/* 实际检索范围提示 */}
          <Tooltip
            title={
              effectiveSearchScope.type === 'mention'
                ? `将在以下文件中检索：${effectiveSearchScope.files.join(', ')}`
                : effectiveSearchScope.type === 'collection'
                  ? '将在选定文档集内检索'
                  : '将在所有文档中检索'
            }
          >
            <Tag
              icon={effectiveSearchScope.icon}
              color={
                effectiveSearchScope.type === 'mention'
                  ? 'blue'
                  : effectiveSearchScope.type === 'collection'
                    ? 'green'
                    : 'default'
              }
              style={{ margin: 0 }}
            >
              {effectiveSearchScope.label}
            </Tag>
          </Tooltip>
        </div>

        {/* 已选文件标签 */}
        {mentionedFiles.length > 0 && (
          <div className="flex flex-wrap gap-1 items-center">
            <Typography.Text type="secondary" className="text-xs mr-1">
              指定检索：
            </Typography.Text>
            {mentionedFiles.map((m) => {
              const file = readyFiles.find((f) => f.path === m.path)
              const fileName = file?.name || m.token.replace('#', '')
              return (
                <Tag
                  key={m.path}
                  closable
                  onClose={(e) => {
                    e.preventDefault()
                    handleRemoveMention(m.path)
                  }}
                  style={{
                    margin: 0,
                    borderRadius: 12,
                    padding: '0 8px',
                    fontSize: 12
                  }}
                  color="blue"
                >
                  <FileTextOutlined className="mr-1" />
                  {fileName.length > 20 ? fileName.slice(0, 20) + '...' : fileName}
                </Tag>
              )
            })}
            <Typography.Text type="secondary" className="text-xs ml-1">
              (优先于检索范围)
            </Typography.Text>
          </div>
        )}
      </div>
    ),
    [
      questionScope,
      activeDocument,
      collections,
      resolvedCollectionId,
      readyDocuments,
      hasReadyFiles,
      mentionedFiles,
      readyFiles,
      availableTags,
      selectedTags,
      effectiveSearchScope,
      onQuestionScopeChange,
      onCollectionChange,
      onSelectedTagsChange,
      handleRemoveMention
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
