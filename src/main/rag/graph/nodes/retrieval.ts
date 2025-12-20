import { ChatSource } from '../../../../types/chat'
import { ChatGraphState } from '../state'
import { logStep } from './preprocess'
import { detectLanguage, translateQuery } from '../../queryTranslator'
import { buildRagContext } from '../../chat'
import { WebSearcher, formatSearchResults } from '../../webSearch'

/**
 * 翻译节点
 */
export async function translate(state: ChatGraphState): Promise<ChatGraphState> {
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
 * 检索节点
 */
export async function retrieve(state: ChatGraphState): Promise<ChatGraphState> {
  if (state.error) return state
  const t0 = Date.now()
  logStep(state, 'retrieve', 'start', { searchIntent: state.searchIntent })
  try {
    const query = state.translatedQuestion || state.question

    // 1. 本地 RAG 检索
    const built = await buildRagContext(query, {
      sources: state.sources,
      tags: state.tags
    })

    let context = built.context || ''
    const usedSources = built.sources || []
    const isGlobalSearch = built.isGlobalSearch
    const metrics = built.metrics as unknown as Record<string, unknown>

    // 2. 联网搜索 (如果需要)
    if (state.searchIntent) {
      const webSearcher = new WebSearcher()
      const webResults = await webSearcher.search(query)
      if (webResults.length > 0) {
        const webContext = formatSearchResults(webResults)
        context = context.trim()
          ? `[本地知识库]:\n${context}\n\n[互联网搜索结果]:\n${webContext}`
          : `[互联网搜索结果]:\n${webContext}`

        // 将网络结果加入 sources (可选)
        webResults.forEach((r) => {
          usedSources.push({
            content: r.content,
            fileName: r.title,
            filePath: r.url,
            url: r.url,
            score: 0.9,
            fileType: 'url',
            sourceType: 'url',
            siteName: r.title
          } as ChatSource)
        })
      }
    }

    if (!context && built.emptyIndexMessage) {
      const next = {
        ...state,
        answer: built.emptyIndexMessage,
        usedSources: [],
        isGlobalSearch: false,
        context: '',
        contextMetrics: metrics
      }
      logStep(next, 'retrieve', 'end', { ok: true, ms: Date.now() - t0, ...metrics })
      return next
    }

    // 3. 更新状态
    const next = {
      ...state,
      context,
      usedSources,
      isGlobalSearch,
      contextMetrics: metrics
    }

    // 立即通知前端引用来源（如果有回调）
    if (state.onSources && usedSources.length > 0) {
      try {
        state.onSources(usedSources)
      } catch (e) {
        console.warn('Failed to invoke onSources callback', e)
      }
    }

    logStep(next, 'retrieve', 'end', {
      ok: true,
      ms: Date.now() - t0,
      ...metrics,
      contextChars: context.length,
      webResults: state.searchIntent ? 'included' : 'none'
    })
    return next
  } catch (error) {
    const next = { ...state, error: error instanceof Error ? error.message : String(error) }
    logStep(next, 'retrieve', 'end', { ok: false, ms: Date.now() - t0, error: next.error })
    return next
  }
}
