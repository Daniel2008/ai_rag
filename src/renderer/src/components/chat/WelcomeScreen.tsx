import type { CSSProperties, ReactElement } from 'react'
import { Prompts } from '@ant-design/x'
import { Space, Typography, theme as antdTheme } from 'antd'
import { CheckOutlined } from '@ant-design/icons'
import { WELCOME_PROMPTS } from '../../constants/chat'

interface WelcomeScreenProps {
  themeMode: 'light' | 'dark'
  readyDocuments: number
  onPromptClick: (content: string) => void
}

export function WelcomeScreen({
  themeMode,
  readyDocuments,
  onPromptClick
}: WelcomeScreenProps): ReactElement {
  const { token } = antdTheme.useToken()

  return (
    <div className="welcome-container flex flex-1 flex-col items-center justify-center p-8 relative">
      <div className="relative z-10 max-w-2xl w-full">
        {/* 欢迎区域 - 使用卡通助手形象 */}
        <div className="text-center mb-10">
          <div className="inline-block mb-6">
            <div className="avatar-glow" style={{ borderRadius: 20 }}>
              <div
                className="cartoon-assistant cartoon-assistant--idle"
                style={
                  {
                    '--assistant-primary': token.colorPrimary,
                    width: 96,
                    height: 96,
                    borderRadius: 20
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
              </div>
            </div>
          </div>
          <Typography.Title level={2} style={{ marginBottom: 8 }}>
            <span className="gradient-text">你好，我是 RAG 智能助手</span>
          </Typography.Title>
          <Typography.Paragraph type="secondary" style={{ fontSize: 16, marginBottom: 0 }}>
            基于本地知识库的智能问答系统，支持多文档检索与引用追溯
          </Typography.Paragraph>
        </div>

        {/* 功能卡片 */}
        <div className="prompts-container mb-8">
          <Typography.Text type="secondary" className="block text-center mb-4">
            我可以帮你：
          </Typography.Text>
          <Prompts
            items={WELCOME_PROMPTS}
            onItemClick={({ data }) => onPromptClick(String(data.description ?? data.label ?? ''))}
            wrap
          />
        </div>

        {/* 快速开始提示 */}
        <div className="text-center">
          <Typography.Text type="secondary" className="text-sm">
            💡 提示：在左侧「知识库」中导入文档，然后开始对话
          </Typography.Text>
        </div>

        {/* 知识库状态 */}
        {readyDocuments > 0 && (
          <div
            className="mt-6 p-4 rounded-xl text-center"
            style={{
              background:
                themeMode === 'dark' ? 'rgba(129, 140, 248, 0.1)' : 'rgba(79, 70, 229, 0.05)',
              border: `1px solid ${themeMode === 'dark' ? 'rgba(129, 140, 248, 0.2)' : 'rgba(79, 70, 229, 0.1)'}`
            }}
          >
            <Space>
              <CheckOutlined style={{ color: token.colorSuccess }} />
              <Typography.Text>
                知识库已就绪，共 <strong>{readyDocuments}</strong> 个文档可供检索
              </Typography.Text>
            </Space>
          </div>
        )}
      </div>
    </div>
  )
}

