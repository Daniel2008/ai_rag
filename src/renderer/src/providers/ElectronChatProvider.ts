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
  suggestedQuestions?: string[]
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
    // 安全地清理监听器
    if (window.api && typeof window.api.removeAllChatListeners === 'function') {
      window.api.removeAllChatListeners()
    }
  }

  /**
   * 转换请求参数
   */
  transformParams(
    requestParams: Partial<ElectronRequestInput>,

    _options: XRequestOptions<ElectronRequestInput, ElectronRequestOutput>
  ): ElectronRequestInput {
    return {
      conversationKey: requestParams.conversationKey ?? '',
      question: requestParams.question ?? '',
      sources: requestParams.sources ?? this.config.defaultSources,
      tags: requestParams.tags
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

    // 收集 sources 和 suggestions
    const sourcesChunk = chunks.find((c) => c.type === 'sources')
    const suggestionsChunk = chunks.find((c) => c.type === 'suggestions')

    return {
      role: 'assistant',
      content,
      sources: sourcesChunk?.sources,
      suggestedQuestions: suggestionsChunk?.suggestions
    }
  }
}

// ===== 单例模式 API（备用） =====
// 当前 useChatWithXChat 使用 useState 管理 Provider 实例
// 以下单例 API 保留以支持全局状态管理场景

let providerInstance: ElectronChatProvider | null = null

/**
 * 获取或创建 ElectronChatProvider 单例实例
 * @description 适用于需要全局共享 Provider 的场景
 */
export function getElectronChatProvider(config?: ElectronChatProviderConfig): ElectronChatProvider {
  if (!providerInstance) {
    providerInstance = new ElectronChatProvider(config)
  }
  return providerInstance
}

/**
 * 重置 Provider 单例实例
 * @description 在配置变更后调用以重新创建 Provider
 */
export function resetElectronChatProvider(): void {
  if (providerInstance) {
    providerInstance.dispose()
  }
  providerInstance = null
}
