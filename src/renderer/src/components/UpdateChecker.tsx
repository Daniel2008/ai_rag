import { useState, useEffect, type ReactElement } from 'react'
import { Button, Progress, Space, Typography, Alert, Tag, Tooltip } from 'antd'
import { DownloadOutlined, CheckCircleOutlined, SyncOutlined, InfoCircleOutlined } from '@ant-design/icons'

const { Text, Paragraph } = Typography

interface UpdateState {
  isChecking: boolean
  isDownloading: boolean
  isDownloaded: boolean
  availableVersion?: string
  currentVersion: string
  error?: string
  progress?: {
    percent: number
    bytesPerSecond: number
    total: number
    transferred: number
  }
}

export function UpdateChecker(): ReactElement {
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    isDownloading: false,
    isDownloaded: false,
    currentVersion: '1.0.1'
  })

  const [showDetails, setShowDetails] = useState(false)

  useEffect(() => {
    // 检查 window.api 是否可用
    if (!window.api) {
      console.warn('[UpdateChecker] window.api is not available')
      return
    }

    // 获取当前状态
    if (typeof window.api.getUpdateStatus === 'function') {
      window.api.getUpdateStatus().then(setState).catch(console.error)
    }

    // 应用启动时自动检查更新
    if (typeof window.api.checkForUpdates === 'function') {
      // 延迟一小段时间，确保应用完全加载
      setTimeout(async () => {
        try {
          console.log('[UpdateChecker] 启动时自动检查更新...')
          await window.api.checkForUpdates()
        } catch (error) {
          console.error('[UpdateChecker] 自动检查更新失败:', error)
        }
      }, 2000) // 延迟2秒，避免影响应用启动性能
    }

    const listeners: (() => void)[] = []

    // 使用状态变化事件来统一处理所有状态更新
    if (typeof window.api.onUpdateStatusChanged === 'function') {
      const unsubscribe = window.api.onUpdateStatusChanged((status) => {
        setState(() => status)
        // 如果发现新版本，自动展开详情面板
        if (status.availableVersion && !status.isDownloaded && !status.isDownloading) {
          setShowDetails(true)
        }
      })
      if (unsubscribe) listeners.push(unsubscribe)
    }

    // 保留原有的事件监听器作为备用
    if (typeof window.api.onUpdateAvailable === 'function') {
      const unsubscribe = window.api.onUpdateAvailable((info) => {
        setState(prev => ({
          ...prev,
          isChecking: false,
          availableVersion: info.version
        }))
      })
      if (unsubscribe) listeners.push(unsubscribe)
    }

    if (typeof window.api.onUpdateNotAvailable === 'function') {
      const unsubscribe = window.api.onUpdateNotAvailable(() => {
        setState(prev => ({
          ...prev,
          isChecking: false,
          availableVersion: undefined
        }))
      })
      if (unsubscribe) listeners.push(unsubscribe)
    }

    if (typeof window.api.onDownloadProgress === 'function') {
      const unsubscribe = window.api.onDownloadProgress((progress) => {
        setState(prev => ({
          ...prev,
          isDownloading: true,
          progress
        }))
      })
      if (unsubscribe) listeners.push(unsubscribe)
    }

    if (typeof window.api.onUpdateDownloaded === 'function') {
      const unsubscribe = window.api.onUpdateDownloaded((info) => {
        setState(prev => ({
          ...prev,
          isDownloading: false,
          isDownloaded: true,
          availableVersion: info.version
        }))
      })
      if (unsubscribe) listeners.push(unsubscribe)
    }

    if (typeof window.api.onUpdateError === 'function') {
      const unsubscribe = window.api.onUpdateError((error) => {
        setState(prev => ({
          ...prev,
          isChecking: false,
          isDownloading: false,
          error: error.error
        }))
      })
      if (unsubscribe) listeners.push(unsubscribe)
    }

    // 清理函数
    return () => {
      listeners.forEach(unsubscribe => unsubscribe())
      if (typeof window.api.removeAllUpdateListeners === 'function') {
        window.api.removeAllUpdateListeners()
      }
    }
  }, [])

  const handleCheckUpdate = async (): Promise<void> => {
    if (!window.api || typeof window.api.checkForUpdates !== 'function') {
      setState(prev => ({ ...prev, error: '更新功能不可用' }))
      return
    }

    setState(prev => ({ ...prev, isChecking: true, error: undefined }))
    try {
      await window.api.checkForUpdates()
    } catch (error) {
      setState(prev => ({ ...prev, isChecking: false, error: String(error) }))
    }
  }

  const handleDownloadUpdate = async (): Promise<void> => {
    if (!window.api || typeof window.api.downloadUpdate !== 'function') {
      setState(prev => ({ ...prev, error: '下载功能不可用' }))
      return
    }

    setState(prev => ({ ...prev, isDownloading: true, error: undefined }))
    try {
      const result = await window.api.downloadUpdate()
      if (!result.success) {
        setState(prev => ({ ...prev, isDownloading: false, error: result.error || '下载失败' }))
      }
    } catch (error) {
      setState(prev => ({ ...prev, isDownloading: false, error: String(error) }))
    }
  }

  const handleInstallUpdate = async (): Promise<void> => {
    if (!window.api || typeof window.api.installUpdate !== 'function') {
      setState(prev => ({ ...prev, error: '安装功能不可用' }))
      return
    }

    try {
      await window.api.installUpdate()
    } catch (error) {
      setState(prev => ({ ...prev, error: String(error) }))
    }
  }

  const handleForceCheckDev = async (): Promise<void> => {
    if (!window.api || typeof window.api.forceCheckUpdateDev !== 'function') {
      setState(prev => ({ ...prev, error: '开发环境检查功能不可用' }))
      return
    }

    setState(prev => ({ ...prev, isChecking: true, error: undefined }))
    try {
      await window.api.forceCheckUpdateDev()
      setState(prev => ({ ...prev, isChecking: false }))
    } catch (error) {
      setState(prev => ({ ...prev, isChecking: false, error: String(error) }))
    }
  }

  // 渲染状态标签
  const renderStatusTag = (): ReactElement => {
    if (state.error) {
      return <Tag color="error">错误</Tag>
    }
    if (state.isDownloading) {
      return <Tag color="processing">下载中</Tag>
    }
    if (state.isDownloaded) {
      return <Tag color="success">已下载</Tag>
    }
    if (state.isChecking) {
      return <Tag color="blue">检查中</Tag>
    }
    if (state.availableVersion) {
      return <Tag color="gold">有新版本</Tag>
    }
    return <Tag color="success">最新版</Tag>
  }

  // 渲染操作按钮
  const renderActions = (): ReactElement => {
    if (state.error) {
      return (
        <Space>
          <Button onClick={handleCheckUpdate} icon={<SyncOutlined />} loading={state.isChecking}>
            重试
          </Button>
          {process.env.NODE_ENV === 'development' && (
            <Button onClick={handleForceCheckDev} type="dashed">
              开发环境测试
            </Button>
          )}
        </Space>
      )
    }

    if (state.isDownloaded) {
      return (
        <Space>
          <Button type="primary" icon={<CheckCircleOutlined />} onClick={handleInstallUpdate}>
            安装并重启
          </Button>
        </Space>
      )
    }

    if (state.isDownloading) {
      return (
        <Space>
          <Button loading disabled>
            下载中...
          </Button>
        </Space>
      )
    }

    if (state.availableVersion) {
      return (
        <Space>
          <Button type="primary" icon={<DownloadOutlined />} onClick={handleDownloadUpdate}>
            下载更新
          </Button>
          <Button onClick={handleCheckUpdate} icon={<SyncOutlined />}>
            重新检查
          </Button>
        </Space>
      )
    }

    return (
      <Space>
        <Button 
          onClick={handleCheckUpdate} 
          icon={<SyncOutlined />} 
          loading={state.isChecking}
        >
          检查更新
        </Button>
        {process.env.NODE_ENV === 'development' && (
          <Tooltip title="在开发环境中模拟更新检查">
            <Button onClick={handleForceCheckDev} type="dashed">
              开发测试
            </Button>
          </Tooltip>
        )}
      </Space>
    )
  }

  // 渲染进度信息
  const renderProgress = (): ReactElement | null => {
    if (!state.progress || !state.isDownloading) return null

    const { percent, bytesPerSecond, transferred, total } = state.progress
    const speedMB = (bytesPerSecond / 1024 / 1024).toFixed(1)
    const transferredMB = (transferred / 1024 / 1024).toFixed(1)
    const totalMB = (total / 1024 / 1024).toFixed(1)

    return (
      <div style={{ marginTop: 12 }}>
        <Progress 
          percent={percent} 
          status={state.error ? 'exception' : 'active'}
          format={(p) => `${Math.round(p ?? percent)}%`}
        />
        <Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 0, fontSize: 12 }}>
          {speedMB} MB/s • {transferredMB} MB / {totalMB} MB
        </Paragraph>
      </div>
    )
  }

  // 渲染错误信息
  const renderError = (): ReactElement | null => {
    if (!state.error) return null
    return (
      <Alert
        message="更新错误"
        description={state.error}
        type="error"
        showIcon
        style={{ marginTop: 12 }}
      />
    )
  }

  // 渲染版本信息
  const renderVersionInfo = (): ReactElement => {
    const versionText = state.availableVersion 
      ? `当前版本: ${state.currentVersion} → 新版本: ${state.availableVersion}`
      : `当前版本: ${state.currentVersion}`

    return (
      <div style={{ marginBottom: 8 }}>
        <Text type="secondary" style={{ fontSize: 12 }}>
          {versionText}
        </Text>
        {state.availableVersion && (
          <Tooltip title="发现新版本可用">
            <InfoCircleOutlined style={{ marginLeft: 6, color: '#faad14' }} />
          </Tooltip>
        )}
      </div>
    )
  }

  return (
    <div style={{ padding: '16px 0' }}>
      <div style={{ 
        display: 'flex', 
        justifyContent: 'space-between', 
        alignItems: 'center',
        marginBottom: 12 
      }}>
        <Space>
          <Text strong>自动更新</Text>
          {renderStatusTag()}
        </Space>
        <Button 
          size="small" 
          type="text"
          onClick={() => setShowDetails(!showDetails)}
        >
          {showDetails ? '隐藏详情' : '查看详情'}
        </Button>
      </div>

      {showDetails && (
        <>
          {renderVersionInfo()}
          {renderActions()}
          {renderProgress()}
          {renderError()}
          
          <div style={{ marginTop: 16, paddingTop: 12, borderTop: '1px solid #f0f0f0' }}>
            <Text type="secondary" style={{ fontSize: 11 }}>
              提示：应用会在启动时自动检查更新，也可以手动检查并安装。
            </Text>
          </div>
        </>
      )}
    </div>
  )
}

export default UpdateChecker
