import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'
import { getSettings } from '../../settings'
import { createChatModel } from '../../utils/createChatModel'
import { logInfo } from '../../utils/logger'

/** 构建 RAG 提示词 */
export function buildPrompt(context: string, question: string, isGlobalSearch: boolean): string {
  const contextInfo = isGlobalSearch
    ? '以下是从整个知识库中检索到的相关内容：'
    : '以下是从指定文档中检索到的相关内容：'

  if (context.trim()) {
    return `你是一个专业的知识助手。${contextInfo}

上下文内容：
${context}

用户问题：${question}

请基于以上上下文内容回答用户的问题。如果上下文中没有相关信息，请如实告知用户"根据检索到的内容，未找到与您问题直接相关的信息"，并尝试基于你已有的知识给出帮助。`
  }

  return `你是一个专业的知识助手。用户的问题是：${question}

当前知识库中未检索到与此问题直接相关的内容。请基于你已有的知识尽可能帮助用户回答这个问题，并友好地提示用户可以上传相关文档以获得更精准的回答。`
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

function asAsyncGenerator(stream: AsyncIterable<string>): AsyncGenerator<string> {
  return (async function* () {
    for await (const chunk of stream) {
      yield chunk
    }
  })()
}

export async function streamAnswer(
  question: string,
  context: string,
  isGlobalSearch: boolean,
  memory?: string
): Promise<AsyncGenerator<string>> {
  const settings = getSettings()
  const memoryBlock = memory?.trim()
    ? `会话记忆（可能有用，若与检索冲突以检索为准）：\n${memory.trim()}\n\n`
    : ''
  const fullContext = memoryBlock + context
  const promptText = buildPrompt(fullContext, question, isGlobalSearch)

  if (settings.provider === 'deepseek' && settings.deepseek.chatModel.includes('reasoner')) {
    logInfo('Using DeepSeek Reasoner', 'Chat')
    const config = settings.deepseek
    if (!config.apiKey) {
      throw new Error('DeepSeek API Key 未设置，请在设置中配置')
    }
    return streamDeepSeekReasoner(
      config.apiKey,
      config.baseUrl || 'https://api.deepseek.com',
      config.chatModel,
      promptText
    )
  }

  const template = buildPrompt('{context}', '{question}', isGlobalSearch)

  const prompt = PromptTemplate.fromTemplate(template)
  const model = createChatModel(settings.provider)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  const stream = await chain.stream({ context: fullContext, question })
  return asAsyncGenerator(stream)
}
