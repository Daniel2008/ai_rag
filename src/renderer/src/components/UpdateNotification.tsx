import { useState, useEffect, type ReactElement } from 'react'
import { Button, Tag, Space, Typography, Badge } from 'antd'
import { DownloadOutlined, CheckCircleOutlined, SyncOutlined, InfoCircleOutlined } from '@ant-design/icons'

const { Text } = Typography

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

/**
 * 轻量级更新通知组件 - 显示在应用右上角
 * 用于应用启动时的自动更新提示
 */
export function UpdateNotification(): ReactElement | null {
  const [state, setState] = useState<UpdateState>({
    isChecking: false,
    isDownloading: false,
    isDownloaded: false,
    currentVersion: '1.0.1'
  })

  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // 检查 window.api 是否可用
    if (!window.api) {
      console.warn('[UpdateNotification] window.api is not available')
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
          console.log('[UpdateNotification] 启动时自动检查更新...')
          await window.api.checkForUpdates()
        } catch (error) {
          console.error('[UpdateNotification] 自动检查更新失败:', error)
        }
      }, 2000)
    }

    const listeners: (() => void)[] = []

    // 监听状态变化
    if (typeof window.api.onUpdateStatusChanged === 'function') {
      const unsubscribe = window.api.onUpdateStatusChanged((status) => {
        setState(() => status)
        // 当发现新版本或下载完成时，显示通知
        if ((status.availableVersion && !status.isDownloaded && !status.isDownloading) || status.isDownloaded) {
          setVisible(true)
        }
      })
      if (unsubscribe) listeners.push(unsubscribe)
    }

    // 监听传统事件（备用）
    if (typeof window.api.onUpdateAvailable === 'function') {
      const unsubscribe = window.api.onUpdateAvailable((info) => {
        setState(prev => ({
          ...prev,
          isChecking: false,
          availableVersion: info.version
        }))
        setVisible(true)
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
        setVisible(true)
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
        // 错误时也显示，以便用户知道发生了什么
        setVisible(true)
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

  // 状态判断
  const hasUpdate = state.availableVersion && !state.isDownloaded && !state.isDownloading
  const isDownloading = state.isDownloading
  const isDownloaded = state.isDownloaded
  const hasError = !!state.error
  const isChecking = state.isChecking

  // 如果没有更新、没有错误、没有下载，且不是检查中，则不显示
  if (!visible || (!hasUpdate && !isDownloading && !isDownloaded && !hasError && !isChecking)) {
    return null
  }

  // 渲染内容
  const renderContent = () => {
    if (hasError) {
      return (
        <div style={{ padding: '8px 12px', background: '#fff1f0', border: '1px solid #ffa39e', borderRadius: 6 }}>
          <Space size={8} align="center">
            <Tag color="error">错误</Tag>
            <Text style={{ fontSize: 12 }}>{state.error}</Text>
            <Button size="small" onClick={handleCheckUpdate} icon={<SyncOutlined />} loading={isChecking}>
              重试
            </Button>
            {process.env.NODE_ENV === 'development' && (
              <Button size="small" onClick={handleForceCheckDev} type="dashed">
                开发测试
              </Button>
            )}
            <Button size="small" onClick={() => setVisible(false)}>
              关闭
            </Button>
          </Space>
        </div>
      )
    }

    if (isDownloading) {
      const percent = state.progress?.percent || 0
      return (
        <div style={{ padding: '8px 12px', background: '#e6f7ff', border: '1px solid #91d5ff', borderRadius: 6 }}>
          <Space size={12} align="center">
            <Tag color="processing">下载中</Tag>
            <Text style={{ fontSize: 12 }}>
              进度: {Math.round(percent)}% {state.progress ? `(${(state.progress.bytesPerSecond / 1024 / 1024).toFixed(1)} MB/s)` : ''}
            </Text>
            <Button size="small" disabled loading>
              下载中...
            </Button>
            <Button size="small" onClick={() => setVisible(false)}>
              隐藏
            </Button>
          </Space>
        </div>
      )
    }

    if (isDownloaded) {
      return (
        <div style={{ padding: '8px 12px', background: '#f6ffed', border: '1px solid #b7eb8f', borderRadius: 6 }}>
          <Space size={8} align="center">
            <Tag color="success">已下载</Tag>
            <Text style={{ fontSize: 12 }}>
              新版本 {state.availableVersion} 已准备就绪
            </Text>
            <Button size="small" type="primary" icon={<CheckCircleOutlined />} onClick={handleInstallUpdate}>
              安装并重启
            </Button>
            <Button size="small" onClick={() => setVisible(false)}>
              稍后
            </Button>
          </Space>
        </div>
      )
    }

    if (hasUpdate) {
      return (
        <div style={{ padding: '8px 12px', background: '#fffbe6', border: '1px solid #ffe58f', borderRadius: 6 }}>
          <Space size={8} align="center">
            <Badge count={<InfoCircleOutlined style={{ color: '#faad14' }} />} />
            <Text style={{ fontSize: 12 }}>
              发现新版本 {state.availableVersion}
            </Text>
            <Button size="small" type="primary" icon={<DownloadOutlined />} onClick={handleDownloadUpdate}>
              下载更新
            </Button>
            <Button size="small" onClick={handleCheckUpdate} icon={<SyncOutlined />}>
              重新检查
            </Button>
            <Button size="small" onClick={() => setVisible(false)}>
              关闭
            </Button>
          </Space>
        </div>
      )
    }

    if (isChecking) {
      return (
        <div style={{ padding: '8px 12px', background: '#f0f5ff', border: '1px solid #adc6ff', borderRadius: 6 }}>
          <Space size={8} align="center">
            <Tag color="blue">检查中</Tag>
            <Text style={{ fontSize: 12 }}>正在检查更新...</Text>
            <Button size="small" disabled loading>
              检查中
            </Button>
            <Button size="small" onClick={() => setVisible(false)}>
              隐藏
            </Button>
          </Space>
        </div>
      )
    }

    return null
  }

  return (
    <div style={{ 
      position: 'fixed', 
      top: 50, 
      right: 24, 
      zIndex: 1000,
      maxWidth: 400
    }}>
      {renderContent()}
    </div>
  )
}

export default UpdateNotification
