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
  AutoComplete,
  Modal,
  Slider,
  InputNumber,
  Row,
  Col,
  Switch,
  Menu,
  theme as antdTheme
} from 'antd'
import {
  ApiOutlined,
  RobotOutlined,
  KeyOutlined,
  SettingOutlined,
  CloudDownloadOutlined,
  GlobalOutlined,
  RocketOutlined,
  DatabaseOutlined,
  SearchOutlined,
  ArrowLeftOutlined
} from '@ant-design/icons'
import type { MenuProps } from 'antd'
import type { AppSettings, ModelProvider, EmbeddingProvider } from '../../../types/chat'
import UpdateChecker from '../update/UpdateChecker'

interface SettingsDialogProps {
  isOpen: boolean
  fullScreen?: boolean
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

const LOCAL_EMBEDDING_MODELS = [
  { value: 'multilingual-e5-small', label: '🌍 E5 多语言 Small (推荐，100+语言)' },
  { value: 'multilingual-e5-base', label: '🌍 E5 多语言 Base (更准确，较大)' },
  { value: 'bge-m3', label: '🌍 BGE-M3 (BAAI最新多语言)' },
  { value: 'paraphrase-multilingual', label: '🌍 释义多语言 (兼容性好)' },
  { value: 'bge-small-zh', label: '🇨🇳 BGE Small 中文 (中文专用)' },
  { value: 'bge-base-zh', label: '🇨🇳 BGE Base 中文 (中文专用，更大)' },
  { value: 'nomic-embed-text', label: '🇺🇸 Nomic Embed (英文)' },
  { value: 'all-MiniLM-L6', label: '🇺🇸 MiniLM-L6 (英文轻量)' }
]

const OLLAMA_EMBEDDING_MODELS = [
  'nomic-embed-text',
  'mxbai-embed-large',
  'all-minilm',
  'bge-m3',
  'snowflake-arctic-embed'
]

type SettingsSection = 'model' | 'embedding' | 'rag' | 'enhance' | 'web' | 'update'

const MENU_ITEMS: MenuProps['items'] = [
  { key: 'model', icon: <RobotOutlined />, label: '模型配置' },
  { key: 'embedding', icon: <DatabaseOutlined />, label: '向量模型' },
  { key: 'rag', icon: <SearchOutlined />, label: '检索参数' },
  { key: 'enhance', icon: <RocketOutlined />, label: '增强功能' },
  { key: 'web', icon: <GlobalOutlined />, label: '联网搜索' },
  { key: 'update', icon: <CloudDownloadOutlined />, label: '更新检查' }
]

export function SettingsDialog({ isOpen, fullScreen = false, onClose, onSaved }: SettingsDialogProps): ReactElement {
  const { token } = antdTheme.useToken()
  const [form] = Form.useForm<AppSettings>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [currentProvider, setCurrentProvider] = useState<ModelProvider>('ollama')
  const [embeddingProvider, setEmbeddingProvider] = useState<EmbeddingProvider>('local')
  const [initialSettings, setInitialSettings] = useState<AppSettings>()
  const [activeSection, setActiveSection] = useState<SettingsSection>('model')

  const loadSettings = useCallback(async (): Promise<void> => {
    setLoading(true)
    try {
      const current = await window.api.getSettings()
      const currentWithDefaults: AppSettings = {
        ...current,
        rag: {
          searchLimit: current.rag?.searchLimit ?? 6,
          maxSearchLimit: current.rag?.maxSearchLimit ?? 30,
          minRelevance: current.rag?.minRelevance ?? 0.25,
          useRerank: current.rag?.useRerank ?? false,
          useMultiQuery: current.rag?.useMultiQuery ?? false,
          useWebSearch: current.rag?.useWebSearch ?? false,
          tavilyApiKey: current.rag?.tavilyApiKey ?? ''
        }
      }
      setInitialSettings(currentWithDefaults)
      form.setFieldsValue(currentWithDefaults)
      setCurrentProvider(currentWithDefaults.provider || 'ollama')
      setEmbeddingProvider(currentWithDefaults.embeddingProvider || 'local')
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
      const finalSettings = { ...initialSettings, ...values }
      const result = await window.api.saveSettings(finalSettings)

      if (result?.embeddingChanged) {
        if (result?.reindexingStarted) {
          message.info('嵌入模型已切换，正在后台重建知识库索引...')
        } else {
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

  // 渲染供应商配置
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

  // 渲染各个设置区块内容
  const renderSectionContent = (): ReactElement => {
    switch (activeSection) {
      case 'model':
        return (
          <div className="space-y-6">
            <div>
              <Typography.Title level={5} style={{ marginBottom: 16 }}>
                <RobotOutlined className="mr-2" />
                模型配置
              </Typography.Title>
              <Typography.Text type="secondary" className="block mb-6">
                选择并配置您的 AI 模型供应商
              </Typography.Text>
            </div>

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

            <div
              className="rounded-xl p-5"
              style={{
                background: token.colorPrimaryBg,
                border: `1px solid ${token.colorPrimaryBorder}`
              }}
            >
              <Typography.Text strong className="mb-4 block">
                {PROVIDER_OPTIONS.find((p) => p.value === currentProvider)?.icon}{' '}
                {PROVIDER_OPTIONS.find((p) => p.value === currentProvider)?.label} 配置
              </Typography.Text>
              {renderProviderConfig(currentProvider)}
            </div>
          </div>
        )

      case 'embedding':
        return (
          <div className="space-y-6">
            <div>
              <Typography.Title level={5} style={{ marginBottom: 16 }}>
                <DatabaseOutlined className="mr-2" />
                向量模型
              </Typography.Title>
              <Typography.Text type="secondary" className="block mb-6">
                配置文档嵌入向量化模型
              </Typography.Text>
            </div>

            <Form.Item label="嵌入模式" name="embeddingProvider" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'local', label: '🚀 本地内置 (推荐，首次使用自动下载)' },
                  { value: 'ollama', label: '🦙 Ollama (需要本地运行 Ollama)' }
                ]}
                onChange={(value: EmbeddingProvider) => {
                  setEmbeddingProvider(value)
                  form.setFieldValue(
                    'embeddingModel',
                    value === 'local' ? 'multilingual-e5-small' : 'nomic-embed-text'
                  )
                }}
              />
            </Form.Item>

            <div
              className="rounded-xl p-4"
              style={{ background: token.colorFillQuaternary }}
            >
              <Typography.Text type="secondary" className="text-sm">
                {embeddingProvider === 'local'
                  ? '💡 本地模式：首次使用时自动下载模型（约 50-150MB），无需额外配置'
                  : '💡 Ollama 模式：需要先在本地安装并运行 Ollama，然后拉取对应的嵌入模型'}
              </Typography.Text>
            </div>

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
          </div>
        )

      case 'rag':
        return (
          <div className="space-y-6">
            <div>
              <Typography.Title level={5} style={{ marginBottom: 16 }}>
                <SearchOutlined className="mr-2" />
                检索参数
              </Typography.Title>
              <Typography.Text type="secondary" className="block mb-6">
                调整 RAG 检索的核心参数
              </Typography.Text>
            </div>

            <div
              className="rounded-xl p-5 space-y-6"
              style={{ background: token.colorFillQuaternary }}
            >
              <div>
                <Form.Item label="单次检索数量 (K)" className="mb-2">
                  <Row gutter={16}>
                    <Col span={16}>
                      <Form.Item name={['rag', 'searchLimit']} noStyle>
                        <Slider min={1} max={20} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['rag', 'searchLimit']} noStyle>
                        <InputNumber min={1} max={20} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form.Item>
                <Typography.Text type="secondary" className="text-xs">
                  每次检索最相关的文档块数量，默认 6
                </Typography.Text>
              </div>

              <div>
                <Form.Item label="最大扩展数量 (Max K)" className="mb-2">
                  <Row gutter={16}>
                    <Col span={16}>
                      <Form.Item name={['rag', 'maxSearchLimit']} noStyle>
                        <Slider min={10} max={100} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['rag', 'maxSearchLimit']} noStyle>
                        <InputNumber min={10} max={100} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form.Item>
                <Typography.Text type="secondary" className="text-xs">
                  复杂问题场景下自动扩展检索的最大上限
                </Typography.Text>
              </div>

              <div>
                <Form.Item label="最低相关度 (Threshold)" className="mb-2">
                  <Row gutter={16}>
                    <Col span={16}>
                      <Form.Item name={['rag', 'minRelevance']} noStyle>
                        <Slider min={0} max={1} step={0.05} />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name={['rag', 'minRelevance']} noStyle>
                        <InputNumber min={0} max={1} step={0.05} style={{ width: '100%' }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Form.Item>
                <Typography.Text type="secondary" className="text-xs">
                  过滤低质量结果的阈值，值越高越精准但可能遗漏
                </Typography.Text>
              </div>
            </div>
          </div>
        )

      case 'enhance':
        return (
          <div className="space-y-6">
            <div>
              <Typography.Title level={5} style={{ marginBottom: 16 }}>
                <RocketOutlined className="mr-2" />
                增强功能
              </Typography.Title>
              <Typography.Text type="secondary" className="block mb-6">
                开启高级检索增强能力
              </Typography.Text>
            </div>

            <div className="space-y-4">
              <div
                className="rounded-xl p-5 flex items-center justify-between"
                style={{ background: token.colorFillQuaternary }}
              >
                <div>
                  <Typography.Text strong className="block mb-1">
                    深度重排序 (Rerank)
                  </Typography.Text>
                  <Typography.Text type="secondary" className="text-sm">
                    使用 Cross-Encoder 对检索结果二次打分，显著提升准确率
                  </Typography.Text>
                </div>
                <Form.Item name={['rag', 'useRerank']} valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>

              <div
                className="rounded-xl p-5 flex items-center justify-between"
                style={{ background: token.colorFillQuaternary }}
              >
                <div>
                  <Typography.Text strong className="block mb-1">
                    多查询重写 (Multi-Query)
                  </Typography.Text>
                  <Typography.Text type="secondary" className="text-sm">
                    自动将问题拆解为多个子查询，提升复杂问题的召回覆盖度
                  </Typography.Text>
                </div>
                <Form.Item name={['rag', 'useMultiQuery']} valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>
            </div>
          </div>
        )

      case 'web':
        return (
          <div className="space-y-6">
            <div>
              <Typography.Title level={5} style={{ marginBottom: 16 }}>
                <GlobalOutlined className="mr-2" />
                联网搜索
              </Typography.Title>
              <Typography.Text type="secondary" className="block mb-6">
                当本地知识库无法回答时，自动搜索互联网
              </Typography.Text>
            </div>

            <div
              className="rounded-xl p-5"
              style={{ background: token.colorFillQuaternary }}
            >
              <div className="flex items-center justify-between mb-4">
                <div>
                  <Typography.Text strong className="block mb-1">
                    启用联网搜索
                  </Typography.Text>
                  <Typography.Text type="secondary" className="text-sm">
                    使用 Tavily API 进行网络搜索
                  </Typography.Text>
                </div>
                <Form.Item name={['rag', 'useWebSearch']} valuePropName="checked" noStyle>
                  <Switch />
                </Form.Item>
              </div>

              <Form.Item
                noStyle
                shouldUpdate={(prevValues, currentValues) =>
                  prevValues.rag?.useWebSearch !== currentValues.rag?.useWebSearch
                }
              >
                {({ getFieldValue }) =>
                  getFieldValue(['rag', 'useWebSearch']) && (
                    <Form.Item
                      label="Tavily API Key"
                      name={['rag', 'tavilyApiKey']}
                      className="mb-0 mt-4"
                      rules={[{ required: true, message: '请输入 Tavily API Key' }]}
                    >
                      <Input.Password placeholder="tvly-..." allowClear />
                    </Form.Item>
                  )
                }
              </Form.Item>
            </div>
          </div>
        )

      case 'update':
        return (
          <div className="space-y-6">
            <div>
              <Typography.Title level={5} style={{ marginBottom: 16 }}>
                <CloudDownloadOutlined className="mr-2" />
                更新检查
              </Typography.Title>
              <Typography.Text type="secondary" className="block mb-6">
                检查并安装最新版本
              </Typography.Text>
            </div>

            <UpdateChecker />
          </div>
        )
    }
  }

  // 全屏模式 - 新的双栏布局
  if (fullScreen) {
    return (
      <div className="flex h-full w-full" style={{ background: token.colorBgContainer }}>
        {/* 左侧导航 */}
        <aside
          className="flex flex-col h-full w-60 flex-shrink-0"
          style={{
            background: token.colorBgLayout,
            borderRight: `1px solid ${token.colorBorderSecondary}`
          }}
        >
          {/* 头部 */}
          <div className="px-5 pt-6 pb-4">
            <div className="flex items-center gap-3 mb-6">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center"
                style={{
                  background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
                  boxShadow: '0 4px 12px rgba(79, 70, 229, 0.3)'
                }}
              >
                <SettingOutlined style={{ fontSize: 18, color: '#fff' }} />
              </div>
              <Typography.Title level={5} style={{ margin: 0 }}>
                系统设置
              </Typography.Title>
            </div>
          </div>

          {/* 菜单 */}
          <Menu
            mode="inline"
            selectedKeys={[activeSection]}
            items={MENU_ITEMS}
            onClick={({ key }) => setActiveSection(key as SettingsSection)}
            style={{ border: 'none', background: 'transparent' }}
            className="settings-menu"
          />

          {/* 底部返回按钮 */}
          <div className="mt-auto px-4 py-4">
            <Button
              icon={<ArrowLeftOutlined />}
              onClick={onClose}
              block
              style={{ borderRadius: 10 }}
            >
              返回
            </Button>
          </div>
        </aside>

        {/* 右侧内容 */}
        <main className="flex-1 flex flex-col h-full overflow-hidden">
          <Form form={form} layout="vertical" requiredMark={false} disabled={loading || saving}>
            {/* 内容区域 */}
            <div className="flex-1 overflow-y-auto p-8" style={{ maxWidth: 720 }}>
              {renderSectionContent()}
            </div>
          </Form>

          {/* 底部保存按钮 */}
          <div
            className="px-8 py-4 flex justify-end"
            style={{ borderTop: `1px solid ${token.colorBorderSecondary}` }}
          >
            <Button type="primary" loading={saving} onClick={() => void handleSave()}>
              保存设置
            </Button>
          </div>
        </main>
      </div>
    )
  }

  // Drawer 模式 - 保持原有 Tabs 布局
  return (
    <Drawer
      title="系统设置"
      open={isOpen}
      onClose={onClose}
      rootClassName="settings-drawer"
      destroyOnHidden
      maskClosable={!saving}
      styles={{
        body: { paddingBottom: 88, paddingInline: 20, paddingTop: 16 },
        header: { paddingInline: 20, paddingBlock: 12 },
        wrapper: { width: 'min(520px, 100vw)' }
      }}
    >
      <Form form={form} layout="vertical" requiredMark={false} disabled={loading || saving}>
        <Menu
          mode="horizontal"
          selectedKeys={[activeSection]}
          items={MENU_ITEMS}
          onClick={({ key }) => setActiveSection(key as SettingsSection)}
          style={{ marginBottom: 16 }}
        />
        {renderSectionContent()}
      </Form>

      <div className="settings-drawer-footer w-full border-t border-gray-200 bg-white px-6 py-4 text-right dark:border-gray-700 dark:bg-gray-900">
        <Space>
          <Button onClick={onClose} disabled={saving}>
            返回
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
