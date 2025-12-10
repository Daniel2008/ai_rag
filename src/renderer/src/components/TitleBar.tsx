import { useState, useEffect, type CSSProperties } from 'react'
import type { ReactElement } from 'react'
import { theme as antdTheme } from 'antd'
import { MinusOutlined, BorderOutlined, CloseOutlined, BlockOutlined } from '@ant-design/icons'

// Electron 窗口拖拽区域样式
const dragStyle: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const noDragStyle: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

interface TitleBarProps {
  title?: string
}

export function TitleBar({ title = '智汇' }: TitleBarProps): ReactElement {
  const { token } = antdTheme.useToken()
  const [isMaximized, setIsMaximized] = useState(false)
  const isMac = window.api.platform === 'darwin'

  useEffect(() => {
    // 初始化最大化状态
    window.api.isWindowMaximized().then(setIsMaximized)

    // 监听最大化状态变化
    const unsubscribe = window.api.onMaximizedChange(setIsMaximized)
    return unsubscribe
  }, [])

  const handleMinimize = (): void => {
    window.api.minimizeWindow()
  }

  const handleMaximize = (): void => {
    window.api.maximizeWindow()
  }

  const handleClose = (): void => {
    window.api.closeWindow()
  }

  // macOS 使用原生标题栏按钮，只需要可拖拽区域
  if (isMac) {
    return (
      <div
        className="h-10 flex items-center justify-center select-none"
        style={{
          ...dragStyle,
          background: `linear-gradient(180deg, ${token.colorBgElevated} 0%, ${token.colorBgContainer} 100%)`
        }}
      >
        <span
          className="text-xs font-medium tracking-wide"
          style={{ color: token.colorTextSecondary }}
        >
          {title}
        </span>
      </div>
    )
  }

  // Windows/Linux 自定义标题栏
  return (
    <div
      className="h-10 flex items-center justify-between select-none"
      style={{
        ...dragStyle,
        background: `linear-gradient(180deg, ${token.colorBgElevated} 0%, ${token.colorBgContainer} 100%)`,
        borderBottom: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {/* 左侧：Logo 和标题 */}
      <div className="flex items-center gap-3 pl-4">
        <div
          className="w-6 h-6 rounded-lg flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
            boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)'
          }}
        >
          <svg
            viewBox="0 0 24 24"
            fill="none"
            className="w-4 h-4"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 2L2 7l10 5 10-5-10-5z" />
            <path d="M2 17l10 5 10-5" />
            <path d="M2 12l10 5 10-5" />
          </svg>
        </div>
        <span className="text-sm font-semibold tracking-wide" style={{ color: token.colorText }}>
          {title}
        </span>
      </div>

      {/* 右侧：窗口控制按钮 */}
      <div className="flex h-full" style={noDragStyle}>
        {/* 最小化按钮 */}
        <button
          onClick={handleMinimize}
          className="w-12 h-full flex items-center justify-center transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
          style={{ color: token.colorTextSecondary }}
          title="最小化"
        >
          <MinusOutlined style={{ fontSize: 12 }} />
        </button>

        {/* 最大化/还原按钮 */}
        <button
          onClick={handleMaximize}
          className="w-12 h-full flex items-center justify-center transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
          style={{ color: token.colorTextSecondary }}
          title={isMaximized ? '向下还原' : '最大化'}
        >
          {isMaximized ? (
            <BlockOutlined style={{ fontSize: 12 }} />
          ) : (
            <BorderOutlined style={{ fontSize: 12 }} />
          )}
        </button>

        {/* 关闭按钮 */}
        <button
          onClick={handleClose}
          className="w-12 h-full flex items-center justify-center transition-colors duration-150 hover:bg-red-500 hover:text-white"
          style={{ color: token.colorTextSecondary }}
          title="关闭"
        >
          <CloseOutlined style={{ fontSize: 12 }} />
        </button>
      </div>
    </div>
  )
}

export default TitleBar
