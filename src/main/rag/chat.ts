import { ChatOllama } from '@langchain/ollama'
import { ChatOpenAI } from '@langchain/openai'
import { ChatAnthropic } from '@langchain/anthropic'
import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { searchSimilarDocuments } from './store'
import { RunnableSequence } from '@langchain/core/runnables'
import { Document } from '@langchain/core/documents'
import { getSettings, type ModelProvider } from '../settings'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { ChatSource, ChatResult } from '../../types/chat'

// 重新导出共享类型，保持向后兼容
export type { ChatSource, ChatResult } from '../../types/chat'

interface ChatOptions {
  sources?: string[]
}

/** 根据文件名推断文件类型 */
function inferFileType(fileName: string): ChatSource['fileType'] {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'pdf':
      return 'pdf'
    case 'doc':
    case 'docx':
      return 'word'
    case 'txt':
      return 'text'
    case 'md':
    case 'markdown':
      return 'markdown'
    default:
      // 检查是否是 URL
      if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
        return 'url'
      }
      return 'unknown'
  }
}

/** 去重：相同文件+页码只保留最相关的一个 */
function deduplicateSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Map<string, ChatSource>()

  for (const source of sources) {
    const key = `${source.fileName}:${source.pageNumber || 0}`
    const existing = seen.get(key)

    // 保留分数更高的
    if (!existing || (source.score || 0) > (existing.score || 0)) {
      seen.set(key, source)
    }
  }

  return Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0))
}

// 创建对应供应商的模型实例
function createChatModel(provider: ModelProvider): BaseChatModel {
  const settings = getSettings()

  console.log(`[Chat] Creating model for provider: ${provider}`)

  switch (provider) {
    case 'ollama': {
      const config = settings.ollama
      console.log(`[Chat] Ollama config:`, { baseUrl: settings.ollamaUrl, model: config.chatModel })
      return new ChatOllama({
        baseUrl: settings.ollamaUrl || config.baseUrl,
        model: config.chatModel
      })
    }
    case 'openai': {
      const config = settings.openai
      console.log(`[Chat] OpenAI config:`, {
        hasApiKey: !!config.apiKey,
        baseUrl: config.baseUrl,
        model: config.chatModel
      })
      if (!config.apiKey) {
        throw new Error('OpenAI API Key 未设置，请在设置中配置')
      }
      // 使用类型断言避免类型实例化过深问题
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
      // ChatAnthropic 使用 anthropicApiUrl 而非 baseURL
      // 使用类型断言避免类型实例化过深问题
      return new ChatAnthropic({
        anthropicApiKey: config.apiKey,
        anthropicApiUrl: config.baseUrl,
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'deepseek': {
      // DeepSeek 使用 OpenAI 兼容 API
      const config = settings.deepseek
      console.log(`[Chat] DeepSeek config:`, {
        hasApiKey: !!config.apiKey,
        apiKeyLength: config.apiKey?.length,
        baseUrl: config.baseUrl,
        model: config.chatModel
      })
      if (!config.apiKey) {
        throw new Error('DeepSeek API Key 未设置，请在设置中配置')
      }
      // 使用类型断言避免类型实例化过深问题
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'zhipu': {
      // 智谱 AI 使用 OpenAI 兼容 API
      const config = settings.zhipu
      if (!config.apiKey) {
        throw new Error('智谱 AI API Key 未设置，请在设置中配置')
      }
      // 使用类型断言避免类型实例化过深问题
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'moonshot': {
      // Moonshot 使用 OpenAI 兼容 API
      const config = settings.moonshot
      if (!config.apiKey) {
        throw new Error('Moonshot API Key 未设置，请在设置中配置')
      }
      // 使用类型断言避免类型实例化过深问题
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

// DeepSeek Reasoner 专用流式请求（支持 reasoning_content）
async function* streamDeepSeekReasoner(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string
): AsyncGenerator<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true
    })
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let hasStartedThinking = false
  let hasEndedThinking = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta

        // 处理思维链内容
        if (delta?.reasoning_content) {
          if (!hasStartedThinking) {
            yield '<think>'
            hasStartedThinking = true
          }
          yield delta.reasoning_content
        }

        // 处理正常内容
        if (delta?.content) {
          if (hasStartedThinking && !hasEndedThinking) {
            yield '</think>'
            hasEndedThinking = true
          }
          yield delta.content
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  // 确保思维链标签闭合
  if (hasStartedThinking && !hasEndedThinking) {
    yield '</think>'
  }
}

export async function chatWithRag(
  question: string,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const settings = getSettings()

  // 1. Retrieve relevant documents - 直接在检索时传入 sources 过滤
  const contextDocs = await searchSimilarDocuments(question, {
    k: 4,
    sources: options.sources
  })

  const context = contextDocs.map((doc) => doc.pageContent).join('\n\n')

  console.log(`Retrieved ${contextDocs.length} docs for context`)

  // 2. Extract sources for citations with detailed metadata
  const sources: ChatSource[] = contextDocs.map((doc: Document, index: number) => {
    const metadata = doc.metadata || {}

    // 提取页码
    const rawPageNumber =
      typeof metadata.pageNumber === 'number'
        ? metadata.pageNumber
        : typeof metadata.loc?.pageNumber === 'number'
          ? metadata.loc.pageNumber
          : undefined

    // 提取文件路径和名称
    const filePath = typeof metadata.source === 'string' ? metadata.source : undefined
    const isUrlSource = filePath?.startsWith('http://') || filePath?.startsWith('https://')

    // 优先使用 title（URL 来源），其次 fileName，最后从路径提取
    let fileName = metadata.title || metadata.fileName
    if (!fileName && filePath) {
      const pathPart = filePath.split(/[\\/]/).pop() || 'Unknown'
      // 对 URL 编码的文件名进行解码
      try {
        fileName = decodeURIComponent(pathPart)
      } catch {
        fileName = pathPart
      }
    }
    fileName = fileName || 'Unknown'

    // 提取文件类型
    const fileType = metadata.fileType || metadata.type || (isUrlSource ? 'url' : inferFileType(fileName))

    // 计算相关度分数（基于检索顺序，越靠前越相关）
    const score = 1 - index * 0.15 // 第一个 1.0，第二个 0.85，以此类推

    // 构建详细的来源信息
    const source: ChatSource = {
      content: doc.pageContent.slice(0, 300) + (doc.pageContent.length > 300 ? '...' : ''),
      fileName,
      pageNumber: rawPageNumber && rawPageNumber > 0 ? rawPageNumber : undefined,
      filePath,
      fileType: fileType as ChatSource['fileType'],
      score: Math.max(0.4, score), // 最低 0.4
      position: typeof metadata.position === 'number' ? metadata.position : undefined,
      sourceType: metadata.sourceType || (isUrlSource || metadata.type === 'url' ? 'url' : 'file'),
      siteName: metadata.siteName,
      url: isUrlSource || metadata.type === 'url' ? filePath : undefined,
      fetchedAt: metadata.fetchedAt || metadata.importedAt
    }

    return source
  })

  // 去重：相同文件+页码只保留最相关的一个
  const uniqueSources = deduplicateSources(sources)

  // 3. Construct Prompt
  const promptText = `You are a helpful assistant. Answer the question based on the following context. 
If the context doesn't contain relevant information, say so.

Context:
${context}

Question: ${question}

Answer:`

  // 4. 检查是否是 DeepSeek Reasoner 模型（需要特殊处理思维链）
  const isDeepSeekReasoner =
    settings.provider === 'deepseek' && settings.deepseek.chatModel.includes('reasoner')

  if (isDeepSeekReasoner) {
    console.log('[Chat] Using DeepSeek Reasoner with reasoning_content support')
    const config = settings.deepseek
    if (!config.apiKey) {
      throw new Error('DeepSeek API Key 未设置，请在设置中配置')
    }
    const stream = streamDeepSeekReasoner(
      config.apiKey,
      config.baseUrl || 'https://api.deepseek.com',
      config.chatModel,
      promptText
    )
    return { stream, sources: uniqueSources }
  }

  // 5. 其他模型使用 LangChain
  const template = `You are a helpful assistant. Answer the question based on the following context. 
If the context doesn't contain relevant information, say so.

Context:
{context}

Question: {question}

Answer:`

  const prompt = PromptTemplate.fromTemplate(template)
  const model = createChatModel(settings.provider)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  const stream = await chain.stream({
    context,
    question
  })

  return {
    stream,
    sources: uniqueSources
  }
}

export async function generateConversationTitle(question: string, answer: string): Promise<string> {
  const settings = getSettings()
  const model = createChatModel(settings.provider)

  const template = `Summarize the following conversation into a short title (max 10 characters).
Only return the title, nothing else. Do not use quotes.

Question: {question}
Answer: {answer}

Title:`

  const prompt = PromptTemplate.fromTemplate(template)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  try {
    const title = await chain.invoke({
      question: question.slice(0, 200),
      answer: answer.slice(0, 200)
    })
    return title.trim()
  } catch (error) {
    console.error('Failed to generate title:', error)
    return question.slice(0, 10)
  }
}
