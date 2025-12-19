import { StateGraph, START, END } from '@langchain/langgraph'
import { chatWithRag } from './chat'
import type { ChatSource } from '../../types/chat'

/**
 * LangGraph 聊天状态接口
 *
 * 注意：检索功能已集成在 chatWithRag 中，这里不再单独执行检索
 * 以避免重复调用向量数据库
 */
interface ChatGraphState {
  question: string
  sources?: string[]
  answer?: string
  usedSources?: ChatSource[]
  error?: string
  onToken?: (chunk: string) => void
  [key: string]: unknown
}

/**
 * 生成节点：调用 chatWithRag 执行完整的 RAG 流程
 * chatWithRag 内部已经实现了文档检索，无需额外的 retrieve 节点
 */
async function generate(state: ChatGraphState): Promise<ChatGraphState> {
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

// 定义状态通道配置
const stateChannels = {
  question: { value: (prev: string, next: string) => next || prev },
  sources: { value: (prev?: string[], next?: string[]) => next ?? prev },
  answer: { value: (prev?: string, next?: string) => next ?? prev },
  usedSources: { value: (prev?: ChatSource[], next?: ChatSource[]) => next ?? prev },
  error: { value: (prev?: string, next?: string) => next ?? prev },
  onToken: { value: (prev?: (chunk: string) => void, next?: (chunk: string) => void) => next ?? prev }
}

// 简化的图结构：直接执行 generate 节点（内部包含检索和生成）
const chatGraph = new StateGraph<ChatGraphState>({ channels: stateChannels as unknown as Record<string, unknown> })
  .addNode('generate', generate)
  .addEdge(START, 'generate')
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

