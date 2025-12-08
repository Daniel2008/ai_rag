import { Component, ErrorInfo, ReactNode } from 'react'

interface Props {
  children: ReactNode
}

interface State {
  hasError: boolean
  error: Error | null
  errorInfo: ErrorInfo | null
  errorTime: number | null
}

// 存储最近的错误，防止 HMR 时丢失
let lastError: { error: Error; errorInfo: ErrorInfo | null; time: number } | null = null

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null,
    errorTime: null
  }

  constructor(props: Props) {
    super(props)

    // 恢复上次的错误状态（HMR 后）
    if (lastError && Date.now() - lastError.time < 5000) {
      this.state = {
        hasError: true,
        error: lastError.error,
        errorInfo: lastError.errorInfo,
        errorTime: lastError.time
      }
    }
  }

  public static getDerivedStateFromError(error: Error): Partial<State> {
    const time = Date.now()
    lastError = { error, errorInfo: null, time }
    return { hasError: true, error, errorTime: time }
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('🔴 Uncaught error:', error)
    console.error('Component stack:', errorInfo.componentStack)

    lastError = { error, errorInfo, time: Date.now() }
    this.setState({ errorInfo })
  }

  componentDidMount(): void {
    // 捕获全局未处理的 Promise rejection
    window.addEventListener('unhandledrejection', this.handleUnhandledRejection)
    // 捕获全局错误
    window.addEventListener('error', this.handleGlobalError)
  }

  componentWillUnmount(): void {
    window.removeEventListener('unhandledrejection', this.handleUnhandledRejection)
    window.removeEventListener('error', this.handleGlobalError)
  }

  private handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
    const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason))
    console.error('🔴 Unhandled Promise rejection:', error)
    lastError = { error, errorInfo: null, time: Date.now() }
    this.setState({
      hasError: true,
      error,
      errorInfo: null,
      errorTime: Date.now()
    })
  }

  private handleGlobalError = (event: ErrorEvent): void => {
    const error = event.error instanceof Error ? event.error : new Error(event.message)
    console.error('🔴 Global error:', error)
    lastError = { error, errorInfo: null, time: Date.now() }
    this.setState({
      hasError: true,
      error,
      errorInfo: null,
      errorTime: Date.now()
    })
  }

  private handleRetry = (): void => {
    lastError = null
    this.setState({ hasError: false, error: null, errorInfo: null, errorTime: null })
  }

  private handleReload = (): void => {
    lastError = null
    window.location.reload()
  }

  private handleCopyError = (): void => {
    const errorText = [
      '=== Error ===',
      this.state.error?.toString(),
      '',
      '=== Stack ===',
      this.state.error?.stack,
      '',
      '=== Component Stack ===',
      this.state.errorInfo?.componentStack
    ]
      .filter(Boolean)
      .join('\n')

    navigator.clipboard.writeText(errorText).then(() => {
      alert('错误信息已复制到剪贴板')
    })
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            padding: 24,
            background: '#1a1a2e',
            color: '#e0e0e0',
            minHeight: '100vh',
            fontFamily: 'system-ui, -apple-system, sans-serif',
            overflow: 'auto'
          }}
        >
          <div style={{ maxWidth: 900, margin: '0 auto' }}>
            <h1 style={{ color: '#ff6b6b', marginBottom: 8 }}>⚠️ 应用发生错误</h1>
            <p style={{ color: '#888', marginBottom: 24 }}>
              请查看下方错误信息，或尝试重新加载应用
              {this.state.errorTime && (
                <span style={{ marginLeft: 12, fontSize: 12 }}>
                  ({new Date(this.state.errorTime).toLocaleTimeString()})
                </span>
              )}
            </p>

            <div style={{ display: 'flex', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
              <button
                onClick={this.handleRetry}
                style={{
                  padding: '10px 20px',
                  background: '#4a9eff',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500
                }}
              >
                🔄 重试
              </button>
              <button
                onClick={this.handleReload}
                style={{
                  padding: '10px 20px',
                  background: '#333',
                  color: '#fff',
                  border: '1px solid #555',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500
                }}
              >
                🔃 重新加载页面
              </button>
              <button
                onClick={this.handleCopyError}
                style={{
                  padding: '10px 20px',
                  background: '#333',
                  color: '#fff',
                  border: '1px solid #555',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontSize: 14,
                  fontWeight: 500
                }}
              >
                📋 复制错误信息
              </button>
            </div>

            <div
              style={{
                background: '#2d2d44',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16
              }}
            >
              <h3 style={{ color: '#ff6b6b', marginTop: 0, marginBottom: 12 }}>错误信息</h3>
              <pre
                style={{
                  background: '#1e1e30',
                  padding: 16,
                  borderRadius: 6,
                  overflow: 'auto',
                  fontSize: 13,
                  lineHeight: 1.5,
                  color: '#ffb3b3',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 200
                }}
              >
                {this.state.error?.toString() || '未知错误'}
              </pre>
            </div>

            {this.state.error?.stack && (
              <div
                style={{
                  background: '#2d2d44',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 16
                }}
              >
                <h3 style={{ color: '#ffa94d', marginTop: 0, marginBottom: 12 }}>错误堆栈</h3>
                <pre
                  style={{
                    background: '#1e1e30',
                    padding: 16,
                    borderRadius: 6,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: '#c4c4c4',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 300
                  }}
                >
                  {this.state.error.stack}
                </pre>
              </div>
            )}

            {this.state.errorInfo?.componentStack && (
              <div
                style={{
                  background: '#2d2d44',
                  borderRadius: 8,
                  padding: 16,
                  marginBottom: 16
                }}
              >
                <h3 style={{ color: '#69db7c', marginTop: 0, marginBottom: 12 }}>组件堆栈</h3>
                <pre
                  style={{
                    background: '#1e1e30',
                    padding: 16,
                    borderRadius: 6,
                    overflow: 'auto',
                    fontSize: 12,
                    lineHeight: 1.6,
                    color: '#a0a0a0',
                    margin: 0,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxHeight: 300
                  }}
                >
                  {this.state.errorInfo.componentStack}
                </pre>
              </div>
            )}

            <div
              style={{
                marginTop: 24,
                padding: 16,
                background: '#2a2a3e',
                borderRadius: 8,
                borderLeft: '4px solid #4a9eff'
              }}
            >
              <p style={{ margin: 0, color: '#888', fontSize: 13 }}>
                💡 <strong>提示：</strong>打开开发者工具 (F12 或 Ctrl+Shift+I)
                可以查看更详细的错误信息。 如果问题持续存在，请尝试清除应用数据或重新启动应用。
              </p>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
