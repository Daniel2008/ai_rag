/**
 * 共享的聊天模型创建函数
 * 统一管理不同提供商的模型实例化
 */
import { ChatOllama } from '@langchain/ollama'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import { getSettings, type ModelProvider } from '../settings'

/**
 * 根据供应商创建对应的聊天模型实例
 * @param provider 模型提供商，如果不传则使用设置中的默认提供商
 */
export function createChatModel(provider?: ModelProvider): BaseChatModel {
  const settings = getSettings()
  const actualProvider = provider ?? settings.provider

  console.log(`[ChatModel] Creating model for provider: ${actualProvider}`)

  switch (actualProvider) {
    case 'ollama': {
      const config = settings.ollama
      console.log(`[ChatModel] Ollama config:`, {
        baseUrl: settings.ollamaUrl,
        model: config.chatModel
      })
      return new ChatOllama({
        baseUrl: settings.ollamaUrl || config.baseUrl,
        model: config.chatModel
      })
    }
    case 'openai': {
      const config = settings.openai
      console.log(`[ChatModel] OpenAI config:`, {
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.chatModel
      })
      if (!config.apiKey) {
        throw new Error('OpenAI API Key 未设置，请在设置中配置')
      }
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'anthropic': {
      const config = settings.anthropic
      if (!config.apiKey) {
        throw new Error('Anthropic API Key 未设置，请在设置中配置')
      }
      return new ChatAnthropic({
        anthropicApiKey: config.apiKey,
        anthropicApiUrl: config.baseUrl,
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'deepseek': {
      const config = settings.deepseek
      console.log(`[ChatModel] DeepSeek config:`, {
        hasApiKey: !!config.apiKey,
        apiKeyLength: config.apiKey?.length,
        baseUrl: config.baseUrl,
        model: config.chatModel
      })
      if (!config.apiKey) {
        throw new Error('DeepSeek API Key 未设置，请在设置中配置')
      }
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'zhipu': {
      const config = settings.zhipu
      if (!config.apiKey) {
        throw new Error('智谱 AI API Key 未设置，请在设置中配置')
      }
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'moonshot': {
      const config = settings.moonshot
      if (!config.apiKey) {
        throw new Error('Moonshot API Key 未设置，请在设置中配置')
      }
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    default:
      throw new Error(`不支持的模型提供商: ${actualProvider}`)
  }
}

export default createChatModel