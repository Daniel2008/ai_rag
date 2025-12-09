/**
 * 自定义 Chat Provider - 适配 Electron IPC 通信
 * 继承 AbstractChatProvider，用于 useXChat
 */

import { AbstractChatProvider, type XRequestOptions } from '@ant-design/x-sdk'
import type { ChatSource } from '../types/chat'
import {
  ElectronXRequest,
  type ElectronRequestInput,
  type ElectronRequestOutput
} from './ElectronXRequest'

// 跟踪活跃的请求实例，用于清理
const activeRequests = new Set<ElectronXRequest>()

/** 聊天消息类型 */
export interface ElectronChatMessage {
  role: 'user' | 'assistant'
  content: string
  sources?: ChatSource[]
}

/** Provider 配置 */
export interface ElectronChatProviderConfig {
  /** 默认来源文件 */
  defaultSources?: string[]
}

/**
 * Electron Chat Provider
 * 通过 Electron IPC 与主进程通信
 */
export class ElectronChatProvider extends AbstractChatProvider<
  ElectronChatMessage,
  ElectronRequestInput,
  ElectronRequestOutput
> {
  private pendingSources: ChatSource[] = []
  private config: ElectronChatProviderConfig

  constructor(config: ElectronChatProviderConfig = {}) {
    super({
      request: () => {
        const request = new ElectronXRequest({
          manual: true
        })
        activeRequests.add(request)
        return request
      }
    })
    this.config = config
  }

  /**
   * 清理所有活跃的请求和监听器
   * 在组件卸载时调用
   */
  dispose(): void {
    for (const request of activeRequests) {
      request.dispose()
    }
    activeRequests.clear()
    window.api.removeAllChatListeners()
  }

  /**
   * 转换请求参数
   */
  transformParams(
    requestParams: Partial<ElectronRequestInput>,
    _options: XRequestOptions<ElectronRequestInput, ElectronRequestOutput>
  ): ElectronRequestInput {
    return {
      question: requestParams.question ?? '',
      sources: requestParams.sources ?? this.config.defaultSources
    }
  }

  /**
   * 将用户输入转换为本地消息
   */
  transformLocalMessage(requestParams: Partial<ElectronRequestInput>): ElectronChatMessage {
    return {
      role: 'user',
      content: requestParams.question ?? ''
    }
  }

  /**
   * 转换服务器返回的消息
   */
  transformMessage(info: {
    originMessage?: ElectronChatMessage
    chunk?: ElectronRequestOutput
    chunks: ElectronRequestOutput[]
    status: string
    responseHeaders: Headers
  }): ElectronChatMessage {
    const { originMessage, chunk, chunks } = info

    // 收集所有 token
    let content = originMessage?.content ?? ''
    if (chunk?.type === 'token' && chunk.content) {
      content += chunk.content
    }

    // 收集 sources
    const sourcesChunk = chunks.find((c) => c.type === 'sources')
    const sources = sourcesChunk?.sources ?? originMessage?.sources

    return {
      role: 'assistant',
      content,
      sources
    }
  }
}

// 单例实例
let providerInstance: ElectronChatProvider | null = null

/**
 * 获取或创建 ElectronChatProvider 实例
 */
export function getElectronChatProvider(config?: ElectronChatProviderConfig): ElectronChatProvider {
  if (!providerInstance) {
    providerInstance = new ElectronChatProvider(config)
  }
  return providerInstance
}

/**
 * 重置 Provider 实例（用于配置变更时）
 */
export function resetElectronChatProvider(): void {
  providerInstance = null
}
