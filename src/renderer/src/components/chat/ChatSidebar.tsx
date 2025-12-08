import type { ReactElement } from 'react'
import { useCallback } from 'react'
import { Conversations, type ConversationsProps } from '@ant-design/x'
import { Avatar, Badge, Button, Flex, Space, Tooltip, Typography, theme as antdTheme } from 'antd'
import {
  SettingOutlined,
  DeleteOutlined,
  MoonFilled,
  SunFilled,
  PlusOutlined,
  RobotOutlined,
  DatabaseOutlined,
  StarOutlined,
  EditOutlined
} from '@ant-design/icons'
import type { ConversationItem } from '../../types/chat'

interface ChatSidebarProps {
  themeMode: 'light' | 'dark'
  sidebarCollapsed: boolean
  conversationItems: ConversationItem[]
  activeConversationKey: string | undefined
  readyDocuments: number
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
  onThemeChange,
  onActiveConversationChange,
  onCreateNewConversation,
  onDeleteConversation,
  onOpenSettings
}: ChatSidebarProps): ReactElement {
  const { token } = antdTheme.useToken()

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
        <Flex align="center" gap={12} className="mb-4">
          <div className="avatar-glow" style={{ borderRadius: 12 }}>
            <Avatar
              size={44}
              icon={<RobotOutlined style={{ fontSize: 24 }} />}
              style={{
                background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
                borderRadius: 12
              }}
            />
          </div>
          <div>
            <Typography.Title level={4} style={{ margin: 0, marginBottom: 2 }}>
              RAG 助手
            </Typography.Title>
            <Typography.Text type="secondary" className="text-xs">
              本地知识库问答
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
          <Typography.Text type="secondary" className="text-xs font-medium uppercase tracking-wider">
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
          <Badge count={readyDocuments} size="small" style={{ backgroundColor: token.colorSuccess }}>
            <Tooltip title="知识库文档数">
              <Button type="text" icon={<DatabaseOutlined />} />
            </Tooltip>
          </Badge>
        </Flex>
      </div>
    </aside>
  )
}
