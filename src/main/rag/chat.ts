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

export interface ChatSource {
  content: string
  fileName: string
  pageNumber?: number
}

export interface ChatResult {
  stream: AsyncGenerator<string>
  sources: ChatSource[]
}

interface ChatOptions {
  sources?: string[]
}

// 创建对应供应商的模型实例
function createChatModel(provider: ModelProvider): BaseChatModel {
  const settings = getSettings()

  switch (provider) {
    case 'ollama': {
      const config = settings.ollama
      return new ChatOllama({
        baseUrl: settings.ollamaUrl || config.baseUrl,
        model: config.chatModel
      })
    }
    case 'openai': {
      const config = settings.openai
      return new ChatOpenAI({
        openAIApiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        modelName: config.chatModel
      })
    }
    case 'anthropic': {
      const config = settings.anthropic
      return new ChatAnthropic({
        anthropicApiKey: config.apiKey,
        anthropicApiUrl: config.baseUrl,
        modelName: config.chatModel
      })
    }
    case 'deepseek': {
      // DeepSeek 使用 OpenAI 兼容 API
      const config = settings.deepseek
      return new ChatOpenAI({
        openAIApiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        modelName: config.chatModel
      })
    }
    case 'zhipu': {
      // 智谱 AI 使用 OpenAI 兼容 API
      const config = settings.zhipu
      return new ChatOpenAI({
        openAIApiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        modelName: config.chatModel
      })
    }
    case 'moonshot': {
      // Moonshot 使用 OpenAI 兼容 API
      const config = settings.moonshot
      return new ChatOpenAI({
        openAIApiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        modelName: config.chatModel
      })
    }
    default:
      throw new Error(`Unsupported provider: ${provider}`)
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

  // 2. Extract sources for citations
  const sources: ChatSource[] = contextDocs.map((doc: Document) => {
    const rawPageNumber =
      typeof doc.metadata?.pageNumber === 'number'
        ? doc.metadata.pageNumber
        : typeof doc.metadata?.loc?.pageNumber === 'number'
          ? doc.metadata.loc.pageNumber
          : undefined

    return {
      content: doc.pageContent.slice(0, 200) + (doc.pageContent.length > 200 ? '...' : ''),
      fileName: doc.metadata?.source
        ? String(doc.metadata.source).split(/[\\/]/).pop() || 'Unknown'
        : 'Unknown',
      pageNumber: rawPageNumber && rawPageNumber > 0 ? rawPageNumber : undefined
    }
  })

  // 3. Construct Prompt
  const template = `You are a helpful assistant. Answer the question based on the following context. 
If the context doesn't contain relevant information, say so.

Context:
{context}

Question: {question}

Answer:`

  const prompt = PromptTemplate.fromTemplate(template)

  // 4. Initialize Model based on current provider
  const model = createChatModel(settings.provider)

  // 5. Create Chain
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  // 6. Run Chain (Stream)
  const stream = await chain.stream({
    context,
    question
  })

  return {
    stream,
    sources
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
