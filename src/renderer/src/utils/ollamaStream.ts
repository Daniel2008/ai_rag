/**
 * 使用 XStream 处理 Ollama API 的流式响应
 * 直接在渲染进程中调用 Ollama API
 */

import { XStream } from '@ant-design/x-sdk'

/** Ollama 聊天消息格式 */
export interface OllamaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** Ollama 流式响应格式 */
export interface OllamaStreamChunk {
  model: string
  created_at: string
  message: {
    role: string
    content: string
  }
  done: boolean
  done_reason?: string
}

/** 聊天请求参数 */
export interface OllamaChatParams {
  model: string
  messages: OllamaMessage[]
  stream?: boolean
}

/** 流式回调 */
export interface StreamCallbacks {
  onToken?: (token: string) => void
  onComplete?: (fullContent: string) => void
  onError?: (error: Error) => void
}

/**
 * 创建 Ollama JSON 流转换器
 * Ollama 的流式响应是 NDJSON 格式（每行一个 JSON）
 */
function createOllamaTransformStream(): TransformStream<string, OllamaStreamChunk> {
  let buffer = ''

  return new TransformStream({
    transform(chunk, controller) {
      buffer += chunk

      // 按换行符分割，处理完整的 JSON 行
      const lines = buffer.split('\n')
      buffer = lines.pop() || '' // 保留最后一个不完整的行

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue

        try {
          const parsed = JSON.parse(trimmed) as OllamaStreamChunk
          controller.enqueue(parsed)
        } catch (e) {
          console.warn('Failed to parse Ollama chunk:', trimmed, e)
        }
      }
    },
    flush(controller) {
      // 处理剩余的数据
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as OllamaStreamChunk
          controller.enqueue(parsed)
        } catch (e) {
          console.warn('Failed to parse final Ollama chunk:', buffer, e)
        }
      }
    }
  })
}

/**
 * 使用 XStream 调用 Ollama Chat API
 *
 * @example
 * ```ts
 * const stream = await streamOllamaChat({
 *   baseUrl: 'http://localhost:11434',
 *   model: 'qwen2.5',
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * })
 *
 * for await (const chunk of stream) {
 *   console.log(chunk.message.content)
 * }
 * ```
 */
export async function streamOllamaChat(options: {
  baseUrl: string
  model: string
  messages: OllamaMessage[]
  signal?: AbortSignal
}): Promise<AsyncIterable<OllamaStreamChunk>> {
  const { baseUrl, model, messages, signal } = options

  const response = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true
    }),
    signal
  })

  if (!response.ok) {
    throw new Error(`Ollama API error: ${response.status} ${response.statusText}`)
  }

  if (!response.body) {
    throw new Error('Response body is null')
  }

  // 使用 XStream 转换流
  const xStream = XStream<OllamaStreamChunk>({
    readableStream: response.body,
    transformStream: createOllamaTransformStream()
  })

  return xStream
}

/**
 * 简化的聊天函数，带回调
 */
export async function chatWithOllama(
  options: {
    baseUrl: string
    model: string
    messages: OllamaMessage[]
    signal?: AbortSignal
  },
  callbacks: StreamCallbacks
): Promise<string> {
  let fullContent = ''

  try {
    const stream = await streamOllamaChat(options)

    for await (const chunk of stream) {
      if (chunk.message?.content) {
        fullContent += chunk.message.content
        callbacks.onToken?.(chunk.message.content)
      }

      if (chunk.done) {
        break
      }
    }

    callbacks.onComplete?.(fullContent)
    return fullContent
  } catch (error) {
    callbacks.onError?.(error instanceof Error ? error : new Error(String(error)))
    throw error
  }
}

/**
 * 创建可中止的聊天控制器
 */
export function createChatController() {
  let abortController: AbortController | null = null

  return {
    /**
     * 开始新的聊天请求
     */
    async chat(
      options: {
        baseUrl: string
        model: string
        messages: OllamaMessage[]
      },
      callbacks: StreamCallbacks
    ): Promise<string> {
      // 中止之前的请求
      this.abort()

      abortController = new AbortController()

      return chatWithOllama(
        {
          ...options,
          signal: abortController.signal
        },
        callbacks
      )
    },

    /**
     * 中止当前请求
     */
    abort() {
      if (abortController) {
        abortController.abort()
        abortController = null
      }
    },

    /**
     * 检查是否有进行中的请求
     */
    get isRequesting() {
      return abortController !== null
    }
  }
}
