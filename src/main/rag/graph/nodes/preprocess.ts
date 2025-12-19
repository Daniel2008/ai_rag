import { END } from '@langchain/langgraph'
import { ChatGraphState } from '../state'
import { logDebug } from '../../../utils/logger'
import { detectDocumentIntent } from '../../../document'
import { getSettings } from '../../../settings'

export function logStep(
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

export async function preprocess(state: ChatGraphState): Promise<ChatGraphState> {
  logStep(state, 'preprocess', 'start', { questionPreview: state.question.slice(0, 80) })
  const settings = getSettings()
  const question = state.question?.trim()
  if (!question) {
    const next = { ...state, error: '问题内容不能为空' }
    logStep(next, 'preprocess', 'end', { ok: false })
    return next
  }

  // 检测文档生成意图
  const docIntent = detectDocumentIntent(question)

  // 检测联网搜索意图 (需开启设置)
  const searchIntent = settings.rag?.useWebSearch ? detectSearchIntent(question) : false

  // 检测长文分析意图
  const analysisIntent = detectAnalysisIntent(question)

  // 检测知识库概览意图
  const kbOverviewIntent = detectKbOverviewIntent(question)

  const next = {
    ...state,
    question,
    documentIntent: docIntent,
    searchIntent,
    analysisIntent,
    kbOverviewIntent
  }
  logStep(next, 'preprocess', 'end', {
    ok: true,
    hasDocIntent: !!docIntent,
    hasSearchIntent: !!searchIntent,
    hasAnalysisIntent: !!analysisIntent,
    hasKbOverviewIntent: !!kbOverviewIntent
  })
  return next
}

/**
 * 简单的知识库概览意图检测
 */
function detectKbOverviewIntent(question: string): boolean {
  const lowerQuestion = question.toLowerCase()
  return (
    (lowerQuestion.includes('知识库') ||
      lowerQuestion.includes('库里') ||
      lowerQuestion.includes('文档')) &&
    (lowerQuestion.includes('哪些') ||
      lowerQuestion.includes('有什么') ||
      lowerQuestion.includes('概览') ||
      lowerQuestion.includes('统计') ||
      lowerQuestion.includes('多少'))
  )
}

/**
 * 简单的分析意图检测
 */
function detectAnalysisIntent(question: string): boolean {
  const keywords = [
    '分析',
    '摘要',
    '总结',
    '概括',
    '提炼',
    '解读',
    '报告',
    '说明',
    '解释',
    '对比',
    '区别'
  ]
  const lowerQuestion = question.toLowerCase()

  // 1. 包含关键词
  if (keywords.some((k) => lowerQuestion.includes(k))) return true

  // 2. 提问方式判断：针对长文的常见提问
  const patterns = [
    /这(篇|个|份|段).*是在讲什么/i,
    /核心(观点|内容|结论)/i,
    /有哪些(要点|亮点|重点)/i,
    /主要内容(是什么)?/i
  ]
  if (patterns.some((p) => p.test(lowerQuestion))) return true

  return false
}

/**
 * 简单的联网搜索意图检测
 */
function detectSearchIntent(question: string): boolean {
  const keywords = ['搜索', '联网', '查找', '最新', '今天', '最近', '实时', '网上', '互联网']
  const lowerQuestion = question.toLowerCase()

  // 1. 显式要求联网
  if (keywords.some((k) => lowerQuestion.includes(k))) return true

  // 2. 询问实时信息（简单启发式）
  const timeKeywords = ['天气', '股价', '新闻', '赛事', '分数', '发布会']
  if (timeKeywords.some((k) => lowerQuestion.includes(k))) return true

  return false
}

/**
 * 路由节点：决定走 RAG 还是文档生成
 */
export function route(state: ChatGraphState): string | typeof END {
  if (state.error) return END
  if (state.documentIntent) return 'docGenerate'
  if (state.kbOverviewIntent) return 'kbOverview'
  // 如果有搜索意图且没有指定本地来源，或者显式要求搜索
  if (state.searchIntent && (!state.sources || state.sources.length === 0)) {
    return 'translate' // 还是先翻译，翻译后在 retrieve 阶段决定是否联网
  }
  return 'translate'
}
