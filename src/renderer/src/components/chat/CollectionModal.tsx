import type { ReactElement } from 'react'
import { Form, Input, Modal, Select, Space } from 'antd'
import { PlusOutlined, EditOutlined } from '@ant-design/icons'
import type { FormInstance } from 'antd/es/form'
import type { DocumentCollection } from '../../types/files'

interface CollectionModalProps {
  open: boolean
  editingCollection: DocumentCollection | null
  collectionForm: FormInstance
  fileOptions: { label: string; value: string }[]
  onClose: () => void
  onSubmit: () => void
}

export function CollectionModal({
  open,
  editingCollection,
  collectionForm,
  fileOptions,
  onClose,
  onSubmit
}: CollectionModalProps): ReactElement {
  return (
    <Modal
      title={
        <Space>
          {editingCollection ? <EditOutlined /> : <PlusOutlined />}
          {editingCollection ? '编辑文档集' : '新建文档集'}
        </Space>
      }
      open={open}
      onCancel={onClose}
      onOk={onSubmit}
      okText={editingCollection ? '保存' : '创建'}
      cancelText="取消"
      destroyOnHidden
      centered
      width={500}
    >
      <Form form={collectionForm} layout="vertical" className="mt-4">
        <Form.Item
          label="名称"
          name="name"
          rules={[{ required: true, message: '请输入文档集名称' }]}
        >
          <Input placeholder="例如：研报摘要" size="large" />
        </Form.Item>
        <Form.Item label="描述" name="description">
          <Input.TextArea placeholder="补充说明该文档集的用途" rows={3} />
        </Form.Item>
        <Form.Item label="包含文档" name="files">
          <Select
            mode="multiple"
            placeholder="选择要加入的文档（可留空，后续再导入）"
            options={fileOptions}
            optionFilterProp="label"
            size="large"
          />
        </Form.Item>
      </Form>
    </Modal>
  )
}
