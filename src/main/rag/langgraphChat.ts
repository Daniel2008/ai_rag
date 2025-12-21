import { chatGraph } from './graph/chatGraph'
import { ChatSource } from '../../types/chat'

/**
 * 运行 LangGraph 版 RAG，对外提供简单 API（支持流式 token 回调）
 */
export async function runLangGraphChat(
  question: string,
  sources?: string[],
  conversationKey?: string,
  onToken?: (chunk: string) => void,
  tags?: string[],
  onSources?: (sources: ChatSource[]) => void,
  onSuggestions?: (suggestions: string[]) => void
): Promise<{
  answer?: string
  sources?: ChatSource[]
  suggestedQuestions?: string[]
  error?: string
}> {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
  const result = await chatGraph.invoke({
    runId,
    conversationKey,
    question,
    sources,
    onToken,
    onSources,
    onSuggestions,
    tags
  })
  return {
    answer: result.answer,
    sources: result.usedSources,
    suggestedQuestions: result.suggestedQuestions,
    error: result.error
  }
}
