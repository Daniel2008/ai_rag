import { StateGraph, START, END } from '@langchain/langgraph'
import { buildRagContext, streamAnswer, updateConversationMemory } from './chat'
import type { ChatSource } from '../../types/chat'
import { logDebug } from '../utils/logger'
import { getConversationMemory, upsertConversationMemory } from '../db/service'
import { handleDocumentGenerationIfNeeded, detectDocumentIntent } from '../document'
import { translateQuery, detectLanguage } from './queryTranslator'

/**
 * LangGraph 聊天状态接口
 *
 * 注意：检索功能已集成在 chatWithRag 中，这里不再单独执行检索
 * 以避免重复调用向量数据库
 */
interface ChatGraphState {
  runId: string
  conversationKey?: string
  question: string
  sources?: string[]
  memory?: string | null
  context?: string
  isGlobalSearch?: boolean
  answer?: string
  usedSources?: ChatSource[]
  contextMetrics?: Record<string, unknown>
  error?: string
  onToken?: (chunk: string) => void
  // P2 & P3 扩展
  documentIntent?: any // 文档生成意图
  translatedQuestion?: string
  groundingStatus?: 'ok' | 'missing_citations' | 'invalid_citations'
  retryCount?: number
  [key: string]: unknown
}

function logStep(
  state: ChatGraphState,
  step: string,
  phase: 'start' | 'end',
  metadata?: Record<string, unknown>
): void {
  logDebug('LangGraph step', 'LangGraph', {
    runId: state.runId,
    step,
    phase,
    ...metadata
  })
}

async function preprocess(state: ChatGraphState): Promise<ChatGraphState> {
  logStep(state, 'preprocess', 'start', { questionPreview: state.question.slice(0, 80) })
  const question = state.question?.trim()
  if (!question) {
    const next = { ...state, error: '问题内容不能为空' }
    logStep(next, 'preprocess', 'end', { ok: false })
    return next
  }

  // 检测文档生成意图
  const docIntent = detectDocumentIntent(question)

  const next = { ...state, question, documentIntent: docIntent }
  logStep(next, 'preprocess', 'end', { ok: true, hasDocIntent: !!docIntent })
  return next
}

/**
 * 路由节点：决定走 RAG 还是文档生成
 */
function route(state: ChatGraphState): string | typeof END {
  if (state.error) return END
  if (state.documentIntent) return 'docGenerate'
  return 'translate'
}

/**
 * 翻译节点 (P1)
 * 如果检测到英文，尝试翻译成中文以提高检索率
 */
async function translate(state: ChatGraphState): Promise<ChatGraphState> {
  const t0 = Date.now()
  logStep(state, 'translate', 'start')
  const lang = detectLanguage(state.question)
  if (lang === 'en') {
    try {
      const translated = await translateQuery(state.question, 'zh')
      const next = { ...state, translatedQuestion: translated }
      logStep(next, 'translate', 'end', { ok: true, ms: Date.now() - t0, translated })
      return next
    } catch (error) {
      logStep(state, 'translate', 'end', { ok: false, ms: Date.now() - t0, error: String(error) })
      return state
    }
  }
  logStep(state, 'translate', 'end', { ok: true, ms: Date.now() - t0, skip: true })
  return state
}

/**
 * 文档生成节点 (P3)
 */
async function docGenerate(state: ChatGraphState): Promise<ChatGraphState> {
  const t0 = Date.now()
  logStep(state, 'docGenerate', 'start')
  try {
    const generator = handleDocumentGenerationIfNeeded(state.question, state.sources)
    if (!generator) {
      return { ...state, error: '文档生成初始化失败' }
    }

    let answer = ''
    for await (const chunk of generator) {
      state.onToken?.(chunk)
      answer += chunk
    }

    const next = { ...state, answer, usedSources: [] }
    logStep(next, 'docGenerate', 'end', { ok: true, ms: Date.now() - t0 })
    return next
  } catch (error) {
    const next = { ...state, error: error instanceof Error ? error.message : String(error) }
    logStep(next, 'docGenerate', 'end', { ok: false, ms: Date.now() - t0 })
    return next
  }
}

async function memoryLoad(state: ChatGraphState): Promise<ChatGraphState> {
  const t0 = Date.now()
  logStep(state, 'memoryLoad', 'start')
  try {
    if (!state.conversationKey) {
      const next = { ...state, memory: null }
      logStep(next, 'memoryLoad', 'end', { ok: true, ms: Date.now() - t0, hit: false })
      return next
    }
    const memory = getConversationMemory(state.conversationKey)
    const next = { ...state, memory }
    logStep(next, 'memoryLoad', 'end', {
      ok: true,
      ms: Date.now() - t0,
      hit: Boolean(memory && memory.trim())
    })
    return next
  } catch (error) {
    const next = { ...state, memory: null }
    logStep(next, 'memoryLoad', 'end', {
      ok: false,
      ms: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error)
    })
    return next
  }
}

async function retrieve(state: ChatGraphState): Promise<ChatGraphState> {
  if (state.error) return state
  const t0 = Date.now()
  logStep(state, 'retrieve', 'start')
  try {
    const query = state.translatedQuestion || state.question
    const built = await buildRagContext(query, { sources: state.sources })
    if (built.emptyIndexMessage) {
      const next = {
        ...state,
        answer: built.emptyIndexMessage,
        usedSources: [],
        isGlobalSearch: built.isGlobalSearch,
        context: '',
        contextMetrics: built.metrics as unknown as Record<string, unknown>
      }
      logStep(next, 'retrieve', 'end', { ok: true, ms: Date.now() - t0, ...built.metrics })
      return next
    }

    const next = {
      ...state,
      context: built.context,
      usedSources: built.sources,
      isGlobalSearch: built.isGlobalSearch,
      contextMetrics: built.metrics as unknown as Record<string, unknown>
    }
    logStep(next, 'retrieve', 'end', {
      ok: true,
      ms: Date.now() - t0,
      ...built.metrics,
      contextChars: built.context.length
    })
    return next
  } catch (error) {
    const next = { ...state, error: error instanceof Error ? error.message : String(error) }
    logStep(next, 'retrieve', 'end', { ok: false, ms: Date.now() - t0, error: next.error })
    return next
  }
}

async function generate(state: ChatGraphState): Promise<ChatGraphState> {
  if (state.error) return state
  if (state.answer && state.groundingStatus !== 'invalid_citations') return state
  const t0 = Date.now()
  logStep(state, 'generate', 'start', { isRetry: !!state.retryCount })
  try {
    const stream = await streamAnswer(
      state.question,
      state.context || '',
      Boolean(state.isGlobalSearch),
      state.memory || undefined
    )
    let answer = ''
    for await (const chunk of stream) {
      state.onToken?.(chunk)
      answer += chunk
    }
    const next = { ...state, answer, retryCount: (state.retryCount || 0) + (state.answer ? 1 : 0) }
    logStep(next, 'generate', 'end', { ok: true, ms: Date.now() - t0, answerChars: answer.length })
    return next
  } catch (error) {
    const next = { ...state, error: error instanceof Error ? error.message : String(error) }
    logStep(next, 'generate', 'end', { ok: false, ms: Date.now() - t0, error: next.error })
    return next
  }
}

async function postcheck(state: ChatGraphState): Promise<ChatGraphState> {
  const t0 = Date.now()
  logStep(state, 'postcheck', 'start')
  const next = {
    ...state,
    usedSources: state.usedSources || []
  }
  logStep(next, 'postcheck', 'end', {
    ok: !next.error,
    ms: Date.now() - t0,
    sourcesCount: next.usedSources?.length ?? 0
  })
  return next
}

/**
 * 引用校验节点 (P2)
 * 检查模型回答中的引用是否在检索到的 context 中存在
 */
async function groundingCheck(state: ChatGraphState): Promise<ChatGraphState> {
  if (state.error || !state.answer || !state.usedSources?.length) {
    return { ...state, groundingStatus: 'ok' }
  }

  const t0 = Date.now()
  logStep(state, 'groundingCheck', 'start')

  // 简单的正则表达式提取 [1], [2] 等引用
  const citationRegex = /\[(\d+)\]/g
  const matches = [...state.answer.matchAll(citationRegex)]
  const citedIndices = new Set(matches.map((m) => parseInt(m[1])))

  const maxIndex = state.usedSources.length
  const invalidIndices = [...citedIndices].filter((idx) => idx < 1 || idx > maxIndex)

  let groundingStatus: ChatGraphState['groundingStatus'] = 'ok'
  if (citedIndices.size === 0) {
    groundingStatus = 'missing_citations'
  } else if (invalidIndices.length > 0) {
    groundingStatus = 'invalid_citations'
  }

  const next = { ...state, groundingStatus }
  logStep(next, 'groundingCheck', 'end', {
    ok: true,
    ms: Date.now() - t0,
    status: groundingStatus,
    citedCount: citedIndices.size,
    invalidCount: invalidIndices.length
  })
  return next
}

/**
 * 决定是否重试生成 (P2)
 */
function shouldRegenerate(state: ChatGraphState): string {
  if (state.error) return 'memoryUpdate'
  // 如果引用失效且重试次数少于 1 次，则重试
  if (state.groundingStatus === 'invalid_citations' && (state.retryCount || 0) < 1) {
    return 'generate'
  }
  return 'memoryUpdate'
}

async function memoryUpdate(state: ChatGraphState): Promise<ChatGraphState> {
  const t0 = Date.now()
  logStep(state, 'memoryUpdate', 'start')
  try {
    if (!state.conversationKey || !state.answer) {
      const next = { ...state }
      logStep(next, 'memoryUpdate', 'end', { ok: true, ms: Date.now() - t0, updated: false })
      return next
    }

    const nextMemory = await updateConversationMemory(
      state.memory || null,
      state.question,
      state.answer
    )
    if (nextMemory.trim()) {
      upsertConversationMemory(state.conversationKey, nextMemory)
    }
    const next = { ...state, memory: nextMemory }
    logStep(next, 'memoryUpdate', 'end', { ok: true, ms: Date.now() - t0, updated: true })
    return next
  } catch (error) {
    const next = { ...state }
    logStep(next, 'memoryUpdate', 'end', {
      ok: false,
      ms: Date.now() - t0,
      error: error instanceof Error ? error.message : String(error)
    })
    return next
  }
}

// 定义状态通道配置
const stateChannels = {
  runId: { value: (prev: string, next: string) => next || prev },
  conversationKey: { value: (prev?: string, next?: string) => next ?? prev },
  question: { value: (prev: string, next: string) => next || prev },
  sources: { value: (prev?: string[], next?: string[]) => next ?? prev },
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
  documentIntent: { value: (prev: any, next: any) => next ?? prev },
  translatedQuestion: { value: (prev: string, next: string) => next ?? prev },
  groundingStatus: { value: (prev: string, next: string) => next ?? prev },
  retryCount: { value: (prev: number, next: number) => next ?? prev }
}

// 扩展图结构：支持文档生成路由、翻译和引用校验
const chatGraph = new StateGraph<ChatGraphState>({
  channels: stateChannels as unknown as Record<string, unknown>
})
  .addNode('preprocess', preprocess)
  .addNode('docGenerate', docGenerate)
  .addNode('translate', translate)
  .addNode('memoryLoad', memoryLoad)
  .addNode('retrieve', retrieve)
  .addNode('generate', generate)
  .addNode('postcheck', postcheck)
  .addNode('groundingCheck', groundingCheck)
  .addNode('memoryUpdate', memoryUpdate)

  // 连线
  .addEdge(START, 'preprocess')
  .addConditionalEdges('preprocess', route)
  .addEdge('docGenerate', 'memoryUpdate')
  .addEdge('translate', 'memoryLoad')
  .addEdge('memoryLoad', 'retrieve')
  .addEdge('retrieve', 'generate')
  .addEdge('generate', 'postcheck')
  .addEdge('postcheck', 'groundingCheck')
  .addConditionalEdges('groundingCheck', shouldRegenerate)
  .addEdge('memoryUpdate', END)
  .compile()

/**
 * 运行 LangGraph 版 RAG，对外提供简单 API（支持流式 token 回调）
 */
export async function runLangGraphChat(
  question: string,
  sources?: string[],
  conversationKey?: string,
  onToken?: (chunk: string) => void
): Promise<{
  answer?: string
  sources?: ChatSource[]
  error?: string
}> {
  const runId = `${Date.now().toString(36)}-${Math.random().toString(16).slice(2)}`
  const result = await chatGraph.invoke({ runId, conversationKey, question, sources, onToken })
  return {
    answer: result.answer,
    sources: result.usedSources,
    error: result.error
  }
}
