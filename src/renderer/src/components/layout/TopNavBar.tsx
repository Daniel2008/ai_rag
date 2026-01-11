import { useState, useEffect, type CSSProperties, type ReactElement } from 'react'
import { theme as antdTheme } from 'antd'
import { MinusOutlined, BorderOutlined, CloseOutlined, BlockOutlined, BulbOutlined } from '@ant-design/icons'

const dragStyle: CSSProperties = { WebkitAppRegion: 'drag' } as CSSProperties
const noDragStyle: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties

export type TabKey = 'chat' | 'knowledge' | 'settings'

interface TopNavBarProps {
  activeTab: TabKey
  onTabChange: (key: TabKey) => void
}

export function TopNavBar({ activeTab, onTabChange }: TopNavBarProps): ReactElement {
  const { token } = antdTheme.useToken()
  const [isMaximized, setIsMaximized] = useState(false)
  const isMac = (window.api?.platform ?? '') === 'darwin'

  useEffect(() => {
    if (!window.api) return undefined

    if (typeof window.api.isWindowMaximized === 'function') {
      window.api.isWindowMaximized().then(setIsMaximized).catch(console.error)
    }

    if (typeof window.api.onMaximizedChange === 'function') {
      const unsubscribe = window.api.onMaximizedChange(setIsMaximized)
      return unsubscribe
    }

    return undefined
  }, [])

  const handleMinimize = (): void => {
    window.api?.minimizeWindow?.()
  }

  const handleMaximize = (): void => {
    window.api?.maximizeWindow?.()
  }

  const handleClose = (): void => {
    window.api?.closeWindow?.()
  }

  const navItems: { label: string; key: TabKey }[] = [
    { label: '对话', key: 'chat' },
    { label: '知识库', key: 'knowledge' },
    { label: '设置', key: 'settings' }
  ]

  return (
    <div
      className="h-12 flex items-center justify-between select-none relative"
      style={{
        ...dragStyle,
        background: token.colorBgContainer,
        borderBottom: `1px solid ${token.colorBorderSecondary}`
      }}
    >
      {/* Left: Logo and Title */}
      <div className="flex items-center gap-3 pl-4 min-w-[200px] z-10">
        <div
          className="w-8 h-8 rounded-lg flex items-center justify-center"
          style={{
            background: `linear-gradient(135deg, ${token.colorPrimary} 0%, #7c3aed 100%)`,
            boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)'
          }}
        >
          <BulbOutlined style={{ fontSize: 18, color: '#fff' }} />
        </div>
        <span className="text-base font-bold tracking-wide" style={{ color: token.colorText }}>
          AI RAG <span className="text-xs font-normal opacity-60">智能知识助手</span>
        </span>
      </div>

      {/* Center: Custom Navigation Tabs */}
      <div className="absolute left-1/2 top-1/2 transform -translate-x-1/2 -translate-y-1/2 h-full flex items-center" style={noDragStyle}>
        <div className="flex bg-gray-100 dark:bg-gray-800 p-1 rounded-lg gap-1">
          {navItems.map((item) => {
            const isActive = activeTab === item.key
            return (
              <div
                key={item.key}
                onClick={() => onTabChange(item.key)}
                className={`
                  px-4 py-1 rounded-md text-sm font-medium cursor-pointer transition-all duration-200
                  ${isActive
                    ? 'bg-white dark:bg-gray-700 shadow-sm text-primary'
                    : 'text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                  }
                `}
                style={{
                  color: isActive ? token.colorPrimary : undefined
                }}
              >
                {item.label}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right: Window Controls */}
      {!isMac && (
        <div className="flex h-full z-10" style={noDragStyle}>
          <button
            onClick={handleMinimize}
            className="w-12 h-full flex items-center justify-center transition-colors duration-150 hover:bg-black/5 dark:hover:bg-white/10"
            style={{ color: token.colorTextSecondary }}
            title="最小化"
          >
            <MinusOutlined style={{ fontSize: 12 }} />
          </button>

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

          <button
            onClick={handleClose}
            className="w-12 h-full flex items-center justify-center transition-colors duration-150 hover:bg-red-500 hover:text-white"
            style={{ color: token.colorTextSecondary }}
            title="关闭"
          >
            <CloseOutlined style={{ fontSize: 12 }} />
          </button>
        </div>
      )}
    </div>
  )
}

