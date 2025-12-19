/**
 * 自定义 XRequest 实现 - 适配 Electron IPC 通信
 * 实现 AbstractXRequestClass 接口，用于 Electron 环境
 */

import { AbstractXRequestClass, type XRequestOptions } from '@ant-design/x-sdk'
import type { ChatSource } from '../types/chat'

export interface ElectronRequestInput {
  conversationKey: string
  question: string
  sources?: string[]
}

export interface ElectronRequestOutput {
  type: 'token' | 'sources' | 'done' | 'error'
  content?: string
  sources?: ChatSource[]
  error?: string
}

// 性能优化：Token 批量处理配置
const TOKEN_BATCH_INTERVAL = 50 // 批量处理间隔（毫秒）
const TOKEN_BATCH_SIZE = 5 // 最大批量大小

/**
 * Electron IPC 请求类
 * 通过 IPC 与主进程通信，实现流式响应
 */
export class ElectronXRequest extends AbstractXRequestClass<
  ElectronRequestInput,
  ElectronRequestOutput
> {
  private _asyncHandler: Promise<void> | null = null
  private _isRequesting = false
  private _isTimeout = false
  private _isStreamTimeout = false
  private _manual = true
  private resolveHandler: (() => void) | null = null
  private chunks: ElectronRequestOutput[] = []

  // 性能优化：Token 缓冲区
  private tokenBuffer: string = ''
  private batchTimer: ReturnType<typeof setTimeout> | null = null

  get asyncHandler(): Promise<void> {
    return this._asyncHandler ?? Promise.resolve()
  }

  get isTimeout(): boolean {
    return this._isTimeout
  }

  get isStreamTimeout(): boolean {
    return this._isStreamTimeout
  }

  get isRequesting(): boolean {
    return this._isRequesting
  }

  get manual(): boolean {
    return this._manual
  }

  constructor(options?: XRequestOptions<ElectronRequestInput, ElectronRequestOutput>) {
    super('electron-ipc', options)
    this._manual = options?.manual ?? true
  }

  run(params?: ElectronRequestInput): void {
    if (!params) return

    // 检查 window.api 是否可用
    if (!window.api) {
      console.error('[ElectronXRequest] window.api is not available')
      this._isRequesting = false
      this.options.callbacks?.onError?.(new Error('Electron API is not available'))
      return
    }

    this._isRequesting = true
    this.chunks = []
    this.tokenBuffer = ''

    // 创建 Promise 用于跟踪请求状态
    this._asyncHandler = new Promise<void>((resolve) => {
      this.resolveHandler = resolve
    })

    // 性能优化：刷新缓冲区中的 token
    const flushTokenBuffer = (): void => {
      if (this.tokenBuffer) {
        const output: ElectronRequestOutput = { type: 'token', content: this.tokenBuffer }
        this.chunks.push(output)
        this.options.callbacks?.onUpdate?.(output, new Headers())
        this.tokenBuffer = ''
      }
      if (this.batchTimer) {
        clearTimeout(this.batchTimer)
        this.batchTimer = null
      }
    }

    // 性能优化：批量处理 token
    const handleToken = (token: string): void => {
      this.tokenBuffer += token

      // 如果缓冲区足够大，立即刷新
      if (this.tokenBuffer.length >= TOKEN_BATCH_SIZE) {
        flushTokenBuffer()
        return
      }

      // 否则设置定时器延迟刷新
      if (!this.batchTimer) {
        this.batchTimer = setTimeout(flushTokenBuffer, TOKEN_BATCH_INTERVAL)
      }
    }

    const handleSources = (sources: ChatSource[]): void => {
      const output: ElectronRequestOutput = { type: 'sources', sources }
      this.chunks.push(output)
      // sources 不触发 onUpdate，只存储
    }

    const handleDone = (): void => {
      // 刷新剩余的 token
      flushTokenBuffer()

      const output: ElectronRequestOutput = { type: 'done' }
      this.chunks.push(output)
      this._isRequesting = false
      this.options.callbacks?.onSuccess?.(this.chunks, new Headers())
      this.cleanup()
      this.resolveHandler?.()
    }

    const handleError = (error: string): void => {
      // 清理缓冲区
      if (this.batchTimer) {
        clearTimeout(this.batchTimer)
        this.batchTimer = null
      }
      this.tokenBuffer = ''

      this._isRequesting = false
      this.options.callbacks?.onError?.(new Error(error))
      this.cleanup()
      this.resolveHandler?.()
    }

    const cleanup = (): void => {
      if (this.batchTimer) {
        clearTimeout(this.batchTimer)
        this.batchTimer = null
      }
      // 安全地清理监听器
      if (window.api && typeof window.api.removeAllChatListeners === 'function') {
        window.api.removeAllChatListeners()
      }
    }
    this.cleanup = cleanup

    // 安全地注册监听器
    if (typeof window.api.onChatToken === 'function') {
      window.api.onChatToken(handleToken)
    }
    if (typeof window.api.onChatSources === 'function') {
      window.api.onChatSources(handleSources)
    }
    if (typeof window.api.onChatDone === 'function') {
      window.api.onChatDone(handleDone)
    }
    if (typeof window.api.onChatError === 'function') {
      window.api.onChatError(handleError)
    }

    // 发送请求
    if (typeof window.api.chat === 'function') {
      window.api.chat({
        conversationKey: params.conversationKey,
        question: params.question,
        sources: params.sources
      })
    } else {
      console.error('[ElectronXRequest] window.api.chat is not available')
      handleError('Chat API is not available')
    }
  }

  private cleanup: () => void = () => {}

  abort(): void {
    if (this._isRequesting) {
      this._isRequesting = false
      // 清理 token 缓冲
      if (this.batchTimer) {
        clearTimeout(this.batchTimer)
        this.batchTimer = null
      }
      this.tokenBuffer = ''
      // 通知成功（中止也算一种成功结束）
      this.options.callbacks?.onSuccess?.(this.chunks, new Headers())
      this.cleanup()
      this.resolveHandler?.()
    }
  }

  /**
   * 强制清理所有监听器（用于组件卸载时）
   */
  dispose(): void {
    this._isRequesting = false
    if (this.batchTimer) {
      clearTimeout(this.batchTimer)
      this.batchTimer = null
    }
    this.tokenBuffer = ''
    this.cleanup()
    this.resolveHandler?.()
    this.chunks = []
  }
}

/**
 * 创建 Electron XRequest 实例的工厂函数
 */
export function createElectronXRequest(
  options?: XRequestOptions<ElectronRequestInput, ElectronRequestOutput>
): ElectronXRequest {
  return new ElectronXRequest({
    manual: true,
    ...options
  })
}
