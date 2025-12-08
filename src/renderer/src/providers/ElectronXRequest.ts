/**
 * 自定义 XRequest 实现 - 适配 Electron IPC 通信
 * 实现 AbstractXRequestClass 接口，用于 Electron 环境
 */

import { AbstractXRequestClass, type XRequestOptions } from '@ant-design/x-sdk'
import type { ChatSource } from '../types/chat'

export interface ElectronRequestInput {
  question: string
  sources?: string[]
}

export interface ElectronRequestOutput {
  type: 'token' | 'sources' | 'done' | 'error'
  content?: string
  sources?: ChatSource[]
  error?: string
}

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

    this._isRequesting = true
    this.chunks = []

    // 创建 Promise 用于跟踪请求状态
    this._asyncHandler = new Promise<void>((resolve) => {
      this.resolveHandler = resolve
    })

    // 设置 IPC 监听器
    const handleToken = (token: string): void => {
      const output: ElectronRequestOutput = { type: 'token', content: token }
      this.chunks.push(output)
      this.options.callbacks?.onUpdate?.(output, new Headers())
    }

    const handleSources = (sources: ChatSource[]): void => {
      const output: ElectronRequestOutput = { type: 'sources', sources }
      this.chunks.push(output)
      // sources 不触发 onUpdate，只存储
    }

    const handleDone = (): void => {
      const output: ElectronRequestOutput = { type: 'done' }
      this.chunks.push(output)
      this._isRequesting = false
      this.options.callbacks?.onSuccess?.(this.chunks, new Headers())
      this.cleanup()
      this.resolveHandler?.()
    }

    const handleError = (error: string): void => {
      this._isRequesting = false
      this.options.callbacks?.onError?.(new Error(error))
      this.cleanup()
      this.resolveHandler?.()
    }

    const cleanup = (): void => {
      window.api.removeAllChatListeners()
    }
    this.cleanup = cleanup

    // 注册监听器
    window.api.onChatToken(handleToken)
    window.api.onChatSources(handleSources)
    window.api.onChatDone(handleDone)
    window.api.onChatError(handleError)

    // 发送请求
    window.api.chat({
      question: params.question,
      sources: params.sources
    })
  }

  private cleanup: () => void = () => {}

  abort(): void {
    if (this._isRequesting) {
      this._isRequesting = false
      // 通知成功（中止也算一种成功结束）
      this.options.callbacks?.onSuccess?.(this.chunks, new Headers())
      this.cleanup()
      this.resolveHandler?.()
    }
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
