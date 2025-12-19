import { buildRagContext, ChatOptions } from './chat/contextBuilder'
import { streamAnswer } from './chat/streamer'
import { ChatResult } from '../../types/chat'

// 重新导出所有子模块的功能
export * from './chat/utils'
export * from './chat/contextBuilder'
export * from './chat/streamer'
export * from './chat/memory'
export * from './chat/title'
export { createChatModel } from '../utils/createChatModel'

/**
 * 主要导出函数：带 RAG 的聊天
 */
export async function chatWithRag(
  question: string,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const built = await buildRagContext(question, options)
  if (built.emptyIndexMessage) {
    return {
      stream: (async function* () {
        yield built.emptyIndexMessage!
      })(),
      sources: []
    }
  }

  const stream = await streamAnswer(question, built.context, built.isGlobalSearch)
  return { stream, sources: built.sources }
}
