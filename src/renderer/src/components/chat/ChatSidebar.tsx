import type { CSSProperties, ReactElement } from 'react'
import { useCallback, useMemo, useState } from 'react'
import { Conversations, type ConversationsProps } from '@ant-design/x'
import {
  Badge,
  Button,
  Flex,
  Input,
  Modal,
  Space,
  Tooltip,
  Typography,
  theme as antdTheme
} from 'antd'
import {
  SettingOutlined,
  DeleteOutlined,
  MoonFilled,
  SunFilled,
  PlusOutlined,
  DatabaseOutlined,
  StarOutlined,
  EditOutlined
} from '@ant-design/icons'
import type { ConversationItem } from '../../types/chat'

export type AssistantPhase = 'idle' | 'thinking' | 'answering' | 'error' | 'processing'

interface ChatSidebarProps {
  themeMode: 'light' | 'dark'
  sidebarCollapsed: boolean
  mode?: 'sidebar' | 'drawer'
  conversationItems: ConversationItem[]
  activeConversationKey?: string
  starredConversationKeys: string[]
  readyDocuments: number
  assistantPhase: AssistantPhase
  processingStatus?: string
  onThemeChange: (mode: 'light' | 'dark') => void
  onActiveConversationChange: (key: string) => void
  onCreateNewConversation: () => Promise<string>
  onRenameConversation: (key: string, label: string) => Promise<void>
  onToggleStarConversation: (key: string) => void
  onDeleteConversation: (key: string) => void
  onOpenSettings: () => void
}

export function ChatSidebar({
  themeMode,
  sidebarCollapsed,
  mode = 'sidebar',
  conversationItems,
  activeConversationKey,
  starredConversationKeys,
  readyDocuments,
  assistantPhase,
  processingStatus,
  onThemeChange,
  onActiveConversationChange,
  onCreateNewConversation,
  onRenameConversation,
  onToggleStarConversation,
  onDeleteConversation,
  onOpenSettings
}: ChatSidebarProps): ReactElement {
  const { token } = antdTheme.useToken()

  const starredSet = useMemo(() => new Set(starredConversationKeys), [starredConversationKeys])
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const [renamingKey, setRenamingKey] = useState<string | null>(null)
  const [renameLoading, setRenameLoading] = useState(false)

  const openRename = useCallback(
    (key: string) => {
      const current = conversationItems.find((c) => c.key === key)
      setRenamingKey(key)
      setRenameValue(current?.label ?? '')
      setRenameOpen(true)
    },
    [conversationItems]
  )

  const handleRenameOk = useCallback(async () => {
    if (!renamingKey) return
    const nextLabel = renameValue.trim()
    if (!nextLabel) return
    setRenameLoading(true)
    try {
      await onRenameConversation(renamingKey, nextLabel)
      setRenameOpen(false)
      setRenamingKey(null)
    } finally {
      setRenameLoading(false)
    }
  }, [onRenameConversation, renamingKey, renameValue])

  // 助手状态文案
  const assistantSubtitle =
    assistantPhase === 'thinking'
      ? '思考中…'
      : assistantPhase === 'answering'
        ? '回答中…'
        : assistantPhase === 'processing'
          ? processingStatus || '处理中…'
          : assistantPhase === 'error'
            ? '出错了，点“重试”再试一次'
            : readyDocuments > 0
              ? '已就绪'
              : '导入文档后开始问答'

  // Conversations 组件的菜单配置
  const conversationsMenuConfig: ConversationsProps['menu'] = useCallback(
    (conversation: { key: string }) => ({
      items: [
        {
          key: 'rename',
          label: '重命名',
          icon: <EditOutlined />
        },
        {
          key: 'star',
          label: starredSet.has(conversation.key) ? '取消收藏' : '收藏',
          icon: (
            <StarOutlined
              style={{
                color: starredSet.has(conversation.key) ? token.colorWarning : token.colorText
              }}
            />
          )
        },
        {
          type: 'divider' as const
        },
        {
          key: 'delete',
          label: '删除对话',
          icon: <DeleteOutlined />,
          danger: true
        }
      ],
      onClick: ({ key }: { key: string }) => {
        if (key === 'rename') {
          openRename(conversation.key)
        }
        if (key === 'star') {
          onToggleStarConversation(conversation.key)
        }
        if (key === 'delete') {
          onDeleteConversation(conversation.key)
        }
      }
    }),
    [
      onDeleteConversation,
      onToggleStarConversation,
      openRename,
      starredSet,
      token.colorText,
      token.colorWarning
    ]
  )

  const widthClass = sidebarCollapsed
    ? 'w-0 overflow-hidden'
    : mode === 'drawer'
      ? 'w-full'
      : 'w-72'

  return (
    <aside
      className={`glass-sidebar flex flex-col transition-all duration-300 ${widthClass}`}
      style={{
        background: token.colorBgContainer,
        borderRight: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {/* Logo 和新建对话 */}
      <div
        className="px-4 pt-5 pb-4"
        style={{ borderBottom: `1px solid ${token.colorBorderSecondary}` }}
      >
        <Flex align="center" gap={12} className="mb-4" style={{ margin: 20, marginLeft: 40 }}>
          <div className="avatar-glow" style={{ borderRadius: 12 }}>
            <div
              className={`cartoon-assistant cartoon-assistant--${assistantPhase === 'processing' ? 'thinking' : assistantPhase}`}
              style={
                {
                  '--assistant-primary': token.colorPrimary
                } as CSSProperties
              }
            >
              <div className="cartoon-assistant__arm cartoon-assistant__arm--left" />
              <div className="cartoon-assistant__arm cartoon-assistant__arm--right" />
              <div className="cartoon-assistant__body">
                <div className="cartoon-assistant__chest" />
              </div>
              <div className="cartoon-assistant__head">
                <div className="cartoon-assistant__face">
                  <div className="cartoon-assistant__eye cartoon-assistant__eye--left" />
                  <div className="cartoon-assistant__eye cartoon-assistant__eye--right" />
                  <div className="cartoon-assistant__mouth" />
                  <div className="cartoon-assistant__cheek cartoon-assistant__cheek--left" />
                  <div className="cartoon-assistant__cheek cartoon-assistant__cheek--right" />
                </div>
              </div>
              <div className="cartoon-assistant__dots" aria-hidden="true">
                <span />
                <span />
                <span />
              </div>
            </div>
          </div>
          <div>
            <Typography.Text type="secondary" className="text-xs">
              {assistantSubtitle}
            </Typography.Text>
          </div>
        </Flex>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          className="mt-5 btn-hover-lift"
          block
          size="large"
          onClick={onCreateNewConversation}
          style={{
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
            border: 'none',
            height: 44,
            borderRadius: 12
          }}
        >
          开始新对话
        </Button>
      </div>

      {/* 对话列表 */}
      <div className="flex-1 overflow-y-auto conversation-list">
        <div className="px-3 py-2">
          <Typography.Text
            type="secondary"
            className="text-xs font-medium uppercase tracking-wider"
          >
            对话历史
          </Typography.Text>
        </div>
        <Conversations
          items={conversationItems}
          activeKey={activeConversationKey}
          onActiveChange={onActiveConversationChange}
          menu={conversationsMenuConfig}
          style={{ padding: '0 8px' }}
        />
      </div>

      {/* 底部操作 */}
      <div className="p-3" style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}>
        <Flex justify="space-between" align="center">
          <Space>
            <Tooltip title="模型设置">
              <Button type="text" icon={<SettingOutlined />} onClick={onOpenSettings} />
            </Tooltip>
            <Tooltip title={themeMode === 'dark' ? '浅色模式' : '深色模式'}>
              <Button
                type="text"
                icon={
                  themeMode === 'dark' ? (
                    <SunFilled style={{ color: '#fbbf24' }} />
                  ) : (
                    <MoonFilled style={{ color: '#6366f1' }} />
                  )
                }
                onClick={() => onThemeChange(themeMode === 'dark' ? 'light' : 'dark')}
              />
            </Tooltip>
          </Space>
          <Badge
            count={readyDocuments}
            size="small"
            style={{ backgroundColor: token.colorSuccess }}
          >
            <Tooltip title="知识库文档数">
              <Button type="text" icon={<DatabaseOutlined />} />
            </Tooltip>
          </Badge>
        </Flex>
      </div>
      <Modal
        title="重命名对话"
        open={renameOpen}
        onOk={() => void handleRenameOk()}
        okButtonProps={{ loading: renameLoading, disabled: !renameValue.trim() }}
        onCancel={() => {
          if (renameLoading) return
          setRenameOpen(false)
          setRenamingKey(null)
        }}
        destroyOnHidden
      >
        <Input
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onPressEnter={() => void handleRenameOk()}
          placeholder="请输入对话名称"
          maxLength={50}
        />
      </Modal>
    </aside>
  )
}
