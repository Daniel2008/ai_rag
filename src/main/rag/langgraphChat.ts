import { StateGraph, START, END, Annotation } from '@langchain/langgraph'
import { chatWithRag } from './chat'
import { searchSimilarDocumentsWithScores } from './store'
import type { ChatSource } from '../../types/chat'
import type { Document } from '@langchain/core/documents'

const ChatState = Annotation.Root({
  question: Annotation<string>(),
  sources: Annotation<string[] | undefined>({ default: undefined }),
  retrieved: Annotation<{ doc: Document; score: number }[] | undefined>({ default: undefined }),
  answer: Annotation<string | undefined>({ default: undefined }),
  usedSources: Annotation<ChatSource[] | undefined>({ default: undefined }),
  error: Annotation<string | undefined>({ default: undefined }),
  onToken: Annotation<((chunk: string) => void) | undefined>({ default: undefined })
})

async function retrieve(state: typeof ChatState.State): Promise<typeof ChatState.State> {
  try {
    const retrieved = await searchSimilarDocumentsWithScores(state.question, {
      sources: state.sources
    })
    return { ...state, retrieved }
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : String(error) }
  }
}

async function generate(state: typeof ChatState.State): Promise<typeof ChatState.State> {
  if (state.error) return state
  try {
    const { stream, sources } = await chatWithRag(state.question, { sources: state.sources })
    let answer = ''
    for await (const chunk of stream) {
      state.onToken?.(chunk)
      answer += chunk
    }
    return { ...state, answer, usedSources: sources }
  } catch (error) {
    return { ...state, error: error instanceof Error ? error.message : String(error) }
  }
}

// 预编译图：retrieve -> generate
const chatGraph = new StateGraph(ChatState)
  .addNode('retrieve', retrieve)
  .addNode('generate', generate)
  .addEdge(START, 'retrieve')
  .addEdge('retrieve', 'generate')
  .addEdge('generate', END)
  .compile()

/**
 * 运行 LangGraph 版 RAG，对外提供简单 API（支持流式 token 回调）
 */
export async function runLangGraphChat(
  question: string,
  sources?: string[],
  onToken?: (chunk: string) => void
): Promise<{
  answer?: string
  sources?: ChatSource[]
  error?: string
}> {
  const result = await chatGraph.invoke({ question, sources, onToken })
  return {
    answer: result.answer,
    sources: result.usedSources,
    error: result.error
  }
}

