import {
  FileTextOutlined,
  QuestionCircleOutlined,
  BulbOutlined,
  SearchOutlined
} from '@ant-design/icons'
import type { ChatMessage } from '../types/chat'

/** 对话持久化存储键名 */
export const CONVERSATIONS_STORAGE_KEY = 'rag_conversations'
export const ACTIVE_CONVERSATION_KEY = 'rag_active_conversation'
export const STARRED_CONVERSATIONS_KEY = 'rag_starred_conversations'

/** 初始系统消息 */
export const INITIAL_MESSAGE: ChatMessage = {
  key: 'system_welcome',
  role: 'system',
  content: '',
  timestamp: Date.now()
}

/** 欢迎页面提示词配置 */
export const WELCOME_PROMPTS = [
  {
    key: 'summary',
    icon: <FileTextOutlined style={{ fontSize: 20 }} />,
    label: '📋 智能总结',
    description: '快速提取文档核心观点和关键信息'
  },
  {
    key: 'qa',
    icon: <QuestionCircleOutlined style={{ fontSize: 20 }} />,
    label: '❓ 精准问答',
    description: '基于知识库内容回答您的问题'
  },
  {
    key: 'analysis',
    icon: <BulbOutlined style={{ fontSize: 20 }} />,
    label: '💡 深度分析',
    description: '对文档内容进行深入分析和洞察'
  },
  {
    key: 'extract',
    icon: <SearchOutlined style={{ fontSize: 20 }} />,
    label: '🔍 信息提取',
    description: '从文档中提取特定类型的信息'
  }
]

/** 快速提问模板 */
export const QUICK_QUESTIONS = [
  '总结这篇文档的主要内容',
  '这个文档讨论了哪些关键问题？',
  '帮我列出文档中的重要数据',
  '这个文档的结论是什么？'
]
