import type { CSSProperties, ReactElement } from 'react'
import { useCallback } from 'react'
import { Conversations, type ConversationsProps } from '@ant-design/x'
import { Badge, Button, Flex, Space, Tooltip, Typography, theme as antdTheme } from 'antd'
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

type AssistantPhase = 'idle' | 'thinking' | 'answering' | 'error'

interface ChatSidebarProps {
  themeMode: 'light' | 'dark'
  sidebarCollapsed: boolean
  conversationItems: ConversationItem[]
  activeConversationKey: string | undefined
  readyDocuments: number
  assistantPhase: AssistantPhase
  onThemeChange: (mode: 'light' | 'dark') => void
  onActiveConversationChange: (key: string | undefined) => void
  onCreateNewConversation: () => void
  onDeleteConversation: (key: string) => void
  onOpenSettings: () => void
}

export function ChatSidebar({
  themeMode,
  sidebarCollapsed,
  conversationItems,
  activeConversationKey,
  readyDocuments,
  assistantPhase,
  onThemeChange,
  onActiveConversationChange,
  onCreateNewConversation,
  onDeleteConversation,
  onOpenSettings
}: ChatSidebarProps): ReactElement {
  const { token } = antdTheme.useToken()

  const assistantSubtitle =
    assistantPhase === 'thinking'
      ? '思考中…'
      : assistantPhase === 'answering'
        ? '回答中…'
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
          label: '收藏',
          icon: <StarOutlined />
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
        if (key === 'delete') {
          onDeleteConversation(conversation.key)
        }
      }
    }),
    [onDeleteConversation]
  )

  return (
    <aside
      className={`glass-sidebar flex flex-col transition-all duration-300 ${sidebarCollapsed ? 'w-0 overflow-hidden' : 'w-72'}`}
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
              className={`cartoon-assistant cartoon-assistant--${assistantPhase}`}
              style={
                {
                  '--assistant-primary': token.colorPrimary
                } as CSSProperties
              }
            >
              <div className="cartoon-assistant__face">
                <div className="cartoon-assistant__eye cartoon-assistant__eye--left" />
                <div className="cartoon-assistant__eye cartoon-assistant__eye--right" />
                <div className="cartoon-assistant__mouth" />
                <div className="cartoon-assistant__cheek cartoon-assistant__cheek--left" />
                <div className="cartoon-assistant__cheek cartoon-assistant__cheek--right" />
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
    </aside>
  )
}
