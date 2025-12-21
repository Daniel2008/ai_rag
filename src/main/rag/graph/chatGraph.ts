import { StateGraph, START, END } from '@langchain/langgraph'
import { ChatGraphState } from './state'
import { preprocess, route } from './nodes/preprocess'
import { translate, retrieve } from './nodes/retrieval'
import { kbOverview } from './nodes/kbOverview'
import { generate, docGenerate } from './nodes/generation'
import { suggest } from './nodes/suggestion'
import { memoryLoad, memoryUpdate } from './nodes/memory'
import { postcheck, groundingCheck, shouldRegenerate } from './nodes/postprocess'
import { ChatSource } from '../../../types/chat'

// 定义状态通道配置
const stateChannels = {
  runId: { value: (prev: string, next: string) => next || prev },
  conversationKey: { value: (prev?: string, next?: string) => next ?? prev },
  question: { value: (prev: string, next: string) => next || prev },
  sources: { value: (_prev?: string[], next?: string[]) => next },
  tags: { value: (_prev?: string[], next?: string[]) => next },
  memory: { value: (prev?: string | null, next?: string | null) => next ?? prev },
  context: { value: (prev?: string, next?: string) => next ?? prev },
  isGlobalSearch: { value: (prev?: boolean, next?: boolean) => next ?? prev },
  answer: { value: (prev?: string, next?: string) => next ?? prev },
  usedSources: { value: (prev?: ChatSource[], next?: ChatSource[]) => next ?? prev },
  contextMetrics: {
    value: (prev?: Record<string, unknown>, next?: Record<string, unknown>) => next ?? prev
  },
  error: { value: (prev?: string, next?: string) => next ?? prev },
  onToken: {
    value: (prev?: (chunk: string) => void, next?: (chunk: string) => void) => next ?? prev
  },
  onSources: {
    value: (prev?: (sources: ChatSource[]) => void, next?: (sources: ChatSource[]) => void) =>
      next ?? prev
  },
  onSuggestions: {
    value: (prev?: (suggestions: string[]) => void, next?: (suggestions: string[]) => void) =>
      next ?? prev
  },
  documentIntent: { value: (prev: unknown, next: unknown) => next ?? prev },
  translatedQuestion: { value: (prev?: string, next?: string) => next ?? prev },
  suggestedQuestions: { value: (prev?: string[], next?: string[]) => next ?? prev },
  kbOverviewData: { value: (prev: unknown, next: unknown) => next ?? prev },
  groundingStatus: { value: (prev?: string, next?: string) => next ?? prev },
  retryCount: { value: (prev?: number, next?: number) => next ?? prev }
}

// 扩展图结构：支持文档生成路由、翻译和引用校验
export const chatGraph = new StateGraph<ChatGraphState>({
  channels: stateChannels as unknown as Record<string, unknown>
})
  .addNode('preprocess', preprocess)
  .addNode('docGenerate', docGenerate)
  .addNode('kbOverview', kbOverview)
  .addNode('translate', translate)
  .addNode('memoryLoad', memoryLoad)
  .addNode('retrieve', retrieve)
  .addNode('generate', generate)
  .addNode('suggest', suggest)
  .addNode('postcheck', postcheck)
  .addNode('groundingCheck', groundingCheck)
  .addNode('memoryUpdate', memoryUpdate)

  // 连线
  .addEdge(START, 'preprocess')
  .addConditionalEdges('preprocess', route)
  .addEdge('kbOverview', 'translate')
  .addEdge('docGenerate', 'memoryUpdate')
  .addEdge('translate', 'memoryLoad')
  .addEdge('memoryLoad', 'retrieve')
  .addEdge('retrieve', 'generate')
  .addEdge('generate', 'postcheck')
  .addEdge('postcheck', 'groundingCheck')
  .addConditionalEdges('groundingCheck', shouldRegenerate)
  // 并行执行 memoryUpdate 和 suggest，通过 END 节点结束
  // 注意：LangGraph 的并行执行是通过从一个节点连接到多个节点实现的
  // 但这里我们希望它们都执行完，且互不依赖
  // 由于 LangGraph JS 的并行执行模型限制，我们这里还是保持串行，但可以在节点内部优化
  .addEdge('groundingCheck', 'suggest')
  .addEdge('suggest', 'memoryUpdate')
  .addEdge('memoryUpdate', END)
  .compile()
