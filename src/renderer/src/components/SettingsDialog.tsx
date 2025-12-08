import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Drawer, Form, Input, Button, Space, Typography, message } from 'antd'

export interface AppSettings {
  ollamaUrl: string
  chatModel: string
  embeddingModel: string
}

interface SettingsDialogProps {
  isOpen: boolean
  onClose: () => void
  onSaved?: (settings: AppSettings) => void
}

export function SettingsDialog({ isOpen, onClose, onSaved }: SettingsDialogProps): ReactElement {
  const [form] = Form.useForm<AppSettings>()
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (isOpen) {
      void loadSettings()
    }
  }, [isOpen])

  const loadSettings = async (): Promise<void> => {
    setLoading(true)
    try {
      const current = await window.api.getSettings()
      form.setFieldsValue(current)
    } catch (error) {
      console.error('Failed to load settings:', error)
      message.error('加载设置失败，请查看控制台日志')
    } finally {
      setLoading(false)
    }
  }

  const handleSave = async (): Promise<void> => {
    try {
      const values = await form.validateFields()
      setSaving(true)
      await window.api.saveSettings(values)
      message.success('设置已保存')
      onSaved?.(values)
    } catch (error) {
      if ((error as { errorFields?: unknown })?.errorFields) {
        return
      }
      console.error('Failed to save settings:', error)
      message.error('保存失败，请稍后重试')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Drawer
      title="模型设置"
      open={isOpen}
      width={420}
      onClose={onClose}
      destroyOnClose
      maskClosable={!saving}
      styles={{
        body: { paddingBottom: 80 }
      }}
    >
      <Typography.Paragraph type="secondary" className="mb-6">
        配置 Ollama 服务与模型名称，以便与本地向量库一同使用。
      </Typography.Paragraph>

      <Form form={form} layout="vertical" requiredMark={false} disabled={loading || saving}>
        <Form.Item
          label="Ollama 服务地址"
          name="ollamaUrl"
          rules={[{ required: true, message: '请输入 Ollama 服务地址' }]}
        >
          <Input placeholder="http://localhost:11434" allowClear />
        </Form.Item>

        <Form.Item
          label="对话模型"
          name="chatModel"
          rules={[{ required: true, message: '请输入对话模型名称' }]}
          extra={<span className="text-xs text-gray-400">例如 qwen2.5:7b 或其他已下载模型</span>}
        >
          <Input allowClear />
        </Form.Item>

        <Form.Item
          label="向量模型"
          name="embeddingModel"
          rules={[{ required: true, message: '请输入向量模型名称' }]}
          extra={
            <span className="text-xs text-gray-400">用于生成文档向量，建议与对话模型同源</span>
          }
        >
          <Input allowClear />
        </Form.Item>
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
