import { ChatGraphState } from '../state'
import { logStep } from './preprocess'
import { streamAnswer } from '../../chat'
import { handleDocumentGenerationIfNeeded } from '../../../document'
import { LongContextAnalyzer } from '../../longContext'

/**
 * 生成节点
 */
export async function generate(state: ChatGraphState): Promise<ChatGraphState> {
  if (state.error) return state
  if (state.answer && state.groundingStatus !== 'invalid_citations') return state
  const t0 = Date.now()
  logStep(state, 'generate', 'start', {
    isRetry: !!state.retryCount,
    analysisIntent: state.analysisIntent
  })
  try {
    // 如果是长文分析意图且 context 较长，则使用长文分析器
    if (state.analysisIntent && (state.context?.length || 0) > 8000) {
      const analyzer = new LongContextAnalyzer()

      // 根据问题简单判断分析类型
      let type: 'summary' | 'entity_extraction' | 'key_points' | 'comprehensive' = 'comprehensive'
      const q = state.question.toLowerCase()
      if (q.includes('摘要') || q.includes('总结')) type = 'summary'
      else if (q.includes('实体') || q.includes('术语') || q.includes('名词'))
        type = 'entity_extraction'
      else if (q.includes('要点') || q.includes('重点')) type = 'key_points'

      const analysis = await analyzer.analyze(state.context || '', { type })

      // 模拟流式输出
      const chunkSize = 20
      for (let i = 0; i < analysis.length; i += chunkSize) {
        state.onToken?.(analysis.slice(i, i + chunkSize))
        await new Promise((resolve) => setTimeout(resolve, 10))
      }

      const next = { ...state, answer: analysis }
      logStep(next, 'generate', 'end', { ok: true, ms: Date.now() - t0, mode: 'long_analysis' })
      return next
    }

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

/**
 * 文档生成节点
 */
export async function docGenerate(state: ChatGraphState): Promise<ChatGraphState> {
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
