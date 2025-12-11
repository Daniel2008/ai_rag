import { useEffect, useState, useCallback } from 'react'
import type { ReactElement } from 'react'
import {
  Drawer,
  Form,
  Input,
  Button,
  Space,
  Typography,
  message,
  Select,
  Divider,
  Collapse,
  AutoComplete,
  Modal
} from 'antd'
import { ApiOutlined, RobotOutlined, KeyOutlined } from '@ant-design/icons'

export type ModelProvider = 'ollama' | 'openai' | 'anthropic' | 'deepseek' | 'zhipu' | 'moonshot'

export interface ProviderConfig {
  apiKey?: string
  baseUrl?: string
  chatModel: string
  embeddingModel?: string
}

export type EmbeddingProvider = 'local' | 'ollama'

export interface AppSettings {
  provider: ModelProvider
  ollama: ProviderConfig
  openai: ProviderConfig
  anthropic: ProviderConfig
  deepseek: ProviderConfig
  zhipu: ProviderConfig
  moonshot: ProviderConfig
  embeddingProvider: EmbeddingProvider
  embeddingModel: string
  ollamaUrl: string
}

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: (settings: AppSettings) => void
}

const PROVIDER_OPTIONS = [
  { value: 'ollama', label: 'Ollama (本地)', icon: '🦙' },
  { value: 'openai', label: 'OpenAI', icon: '🤖' },
  { value: 'anthropic', label: 'Anthropic (Claude)', icon: '🧠' },
  { value: 'deepseek', label: 'DeepSeek', icon: '🔍' },
  { value: 'zhipu', label: '智谱 AI (GLM)', icon: '🇨🇳' },
  { value: 'moonshot', label: 'Moonshot (Kimi)', icon: '🌙' }
]

const MODEL_PRESETS: Record<ModelProvider, string[]> = {
  ollama: ['qwen2.5:7b', 'qwen2.5:14b', 'llama3.2:3b', 'deepseek-r1:7b', 'gemma2:9b'],
  openai: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo', 'o1-mini', 'o1-preview'],
  anthropic: ['claude-3-5-sonnet-20241022', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  zhipu: ['glm-4-plus', 'glm-4-flash', 'glm-4-long', 'glm-4-airx'],
  moonshot: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']
}

// 本地嵌入模型（内置，自动下载）
// 将多语言检索体验最佳的 multilingual-e5-small 设为首选
const LOCAL_EMBEDDING_MODELS = [
  { value: 'multilingual-e5-small', label: 'E5 Small 多语言 (推荐)' },
  { value: 'nomic-embed-text', label: 'Nomic Embed Text v1.5' },
  { value: 'all-MiniLM-L6', label: 'All-MiniLM-L6 (轻量)' },
  { value: 'bge-small-zh', label: 'BGE Small 中文 (中文优化)' }
]

// Ollama 嵌入模型
const OLLAMA_EMBEDDING_MODELS = ['nomic-embed-text', 'mxbai-embed-large', 'all-minilm', 'bge-m3']

export function SettingsDialog({ isOpen, onClose, onSaved }: SettingsDialogProps): ReactElement {
  const [form] = Form.useForm<AppSettings>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<ModelProvider>('ollama')
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>('local')

  const loadSettings = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const current = await window.api.getSettings()
      form.setFieldsValue(current)
      setCurrentProvider(current.provider || 'ollama')
      setEmbeddingProvider(current.embeddingProvider || 'local')
    } catch (error) {
      console.error('Failed to load settings:', error)
      message.error('加载设置失败')
    } finally {
      setLoading(false)
    }
  }, [form])

  useEffect(() => {
    if (isOpen) {
      void loadSettings()
    }
  }, [isOpen, loadSettings])

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      const result = await window.api.saveSettings(values)

      if (result.embeddingChanged) {
        if (result.reindexingStarted) {
          message.info('嵌入模型已切换，正在后台重建知识库索引...')
        } else {
          // 嵌入模型变更，显示警告提示
          Modal.warning({
            title: '嵌入模型已切换',
            content: (
              <div>
                <p>
                  由于不同嵌入模型的向量维度不同，<strong>旧的索引数据将不兼容</strong>。
                </p>
                <p style={{ marginTop: 12 }}>请执行以下操作之一：</p>
                <ul style={{ marginTop: 8, paddingLeft: 20 }}>
                  <li>删除知识库中的所有文档，然后重新导入</li>
                  <li>或在知识库面板中点击&ldquo;重建索引&rdquo;</li>
                </ul>
              </div>
            ),
            okText: '我知道了'
          })
        }
      }
      message.success('设置已保存')
      onSaved?.(values)
    } catch (error) {
      if ((error as { errorFields?: unknown })?.errorFields) {
        return
      }
      console.error('Failed to save settings:', error)
      message.error('保存失败')
    } finally {
      setSaving(false)
    }
  }

  const handleProviderChange = (value: ModelProvider): void => {
    setCurrentProvider(value)
    form.setFieldValue('provider', value)
  }

  const renderProviderConfig = (provider: ModelProvider): ReactElement => {
    const isOllama = provider === 'ollama'
    const modelOptions = MODEL_PRESETS[provider].map((m) => ({ value: m, label: m }))

    return (
      <div key={provider} className="space-y-4">
        {!isOllama && (
          <Form.Item
            label={
              <span>
                <KeyOutlined className="mr-1" />
                API Key
              </span>
            }
            name={[provider, 'apiKey']}
            rules={[{ required: provider === currentProvider, message: '请输入 API Key' }]}
          >
            <Input.Password placeholder="sk-..." allowClear />
          </Form.Item>
        )}

        <Form.Item
          label={
            <span>
              <ApiOutlined className="mr-1" />
              {isOllama ? '服务地址' : 'API 地址'}
            </span>
          }
          name={isOllama ? 'ollamaUrl' : [provider, 'baseUrl']}
          rules={[{ required: provider === currentProvider, message: '请输入服务地址' }]}
        >
          <Input
            placeholder={isOllama ? 'http://localhost:11434' : 'https://api.xxx.com'}
            allowClear
          />
        </Form.Item>

        <Form.Item
          label={
            <span>
              <RobotOutlined className="mr-1" />
              对话模型
            </span>
          }
          name={[provider, 'chatModel']}
          rules={[{ required: provider === currentProvider, message: '请选择或输入模型' }]}
        >
          <AutoComplete
            allowClear
            placeholder="选择或输入模型名称"
            options={modelOptions}
            filterOption={(inputValue, option) =>
              option?.value.toLowerCase().includes(inputValue.toLowerCase()) ?? false
            }
          />
        </Form.Item>
      </div>
    )
  }

  const collapseItems = PROVIDER_OPTIONS.filter((p) => p.value !== currentProvider).map((p) => ({
    key: p.value,
    label: (
      <span>
        <span className="mr-2">{p.icon}</span>
        {p.label}
      </span>
    ),
    children: renderProviderConfig(p.value as ModelProvider)
  }))

  return (
    <Drawer
      title="模型设置"
      open={isOpen}
      width={480}
      onClose={onClose}
      destroyOnClose
      maskClosable={!saving}
      styles={{
        body: { paddingBottom: 80 }
      }}
    >
      <Form form={form} layout="vertical" requiredMark={false} disabled={loading || saving}>
        {/* 当前供应商选择 */}
        <Form.Item label="当前模型供应商" name="provider" rules={[{ required: true }]}>
          <Select
            options={PROVIDER_OPTIONS.map((p) => ({
              value: p.value,
              label: (
                <span>
                  <span className="mr-2">{p.icon}</span>
                  {p.label}
                </span>
              )
            }))}
            onChange={handleProviderChange}
          />
        </Form.Item>

        {/* 当前供应商配置 */}
        <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 dark:border-blue-800 dark:bg-blue-900/20">
          <Typography.Text strong className="mb-3 block">
            {PROVIDER_OPTIONS.find((p) => p.value === currentProvider)?.icon}{' '}
            {PROVIDER_OPTIONS.find((p) => p.value === currentProvider)?.label} 配置
          </Typography.Text>
          {renderProviderConfig(currentProvider)}
        </div>

        <Divider />

        {/* 向量模型设置 */}
        <Typography.Text strong className="mb-3 block">
          📊 向量模型设置
        </Typography.Text>

        <Form.Item label="嵌入模式" name="embeddingProvider" rules={[{ required: true }]}>
          <Select
            options={[
              { value: 'local', label: '🚀 本地内置 (推荐，首次使用自动下载)' },
              { value: 'ollama', label: '🦙 Ollama (需要本地运行 Ollama)' }
            ]}
            onChange={(value: EmbeddingProvider) => {
              setEmbeddingProvider(value)
              // 切换时重置为推荐模型：本地优先 multilingual-e5-small，Ollama 默认 nomic-embed-text
              form.setFieldValue(
                'embeddingModel',
                value === 'local' ? 'multilingual-e5-small' : 'nomic-embed-text'
              )
            }}
          />
        </Form.Item>

        <Typography.Paragraph type="secondary" className="text-xs mb-3">
          {embeddingProvider === 'local'
            ? '本地模式：首次使用时自动下载模型（约 50-150MB），无需额外配置'
            : 'Ollama 模式：需要先在本地安装并运行 Ollama，然后拉取对应的嵌入模型'}
        </Typography.Paragraph>

        <Form.Item
          label="向量模型"
          name="embeddingModel"
          rules={[{ required: true, message: '请选择向量模型' }]}
        >
          {embeddingProvider === 'local' ? (
            <Select options={LOCAL_EMBEDDING_MODELS} placeholder="选择本地嵌入模型" />
          ) : (
            <AutoComplete
              allowClear
              placeholder="选择或输入向量模型"
              options={OLLAMA_EMBEDDING_MODELS.map((m) => ({ value: m, label: m }))}
              filterOption={(inputValue, option) =>
                option?.value.toLowerCase().includes(inputValue.toLowerCase()) ?? false
              }
            />
          )}
        </Form.Item>

        <Divider />

        {/* 其他供应商配置（折叠） */}
        <Typography.Text type="secondary" className="mb-3 block text-xs">
          其他供应商配置（可选，方便切换）
        </Typography.Text>
        <Collapse items={collapseItems} bordered={false} size="small" expandIconPlacement="end" />
      </Form>

      <div className="absolute bottom-0 left-0 w-full border-t border-gray-200 bg-white px-6 py-4 text-right dark:border-gray-700 dark:bg-gray-900">
        <Space>
          <Button onClick={onClose} disabled={saving}>
            取消
          </Button>
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        </Space>
      </div>
    </Drawer>
  )
}

export default SettingsDialog
