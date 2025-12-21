import { ChatGraphState } from '../state'
import { logStep } from './preprocess'
import { SmartPromptGenerator } from '../../smartFeatures'
import { logInfo } from '../../../utils/logger'

/**
 * 建议节点
 * 在生成回答后，生成相关的后续问题建议
 */
export async function suggest(state: ChatGraphState): Promise<ChatGraphState> {
  // 如果已经有建议或者出错了，跳过
  if (state.suggestedQuestions?.length || state.error || !state.answer) {
    return state
  }

  const t0 = Date.now()
  logStep(state, 'suggest', 'start')

  try {
    const generator = new SmartPromptGenerator()
    const context = `问题: ${state.question}\n回答: ${state.answer}`

    if (state.onSuggestions) {
      void generator
        .generatePrompts(context, { count: 3, tone: 'professional' })
        .then((suggestedQuestions) => {
          state.onSuggestions?.(suggestedQuestions)
        })
        .catch((e) => {
          logInfo('Background suggestion generation failed', 'LangGraph', { error: e })
        })

      const next = { ...state }
      logStep(next, 'suggest', 'end', { ok: true, ms: Date.now() - t0, count: 0, async: true })
      return next
    }

    const suggestedQuestions = await generator.generatePrompts(context, {
      count: 3,
      tone: 'professional'
    })
    const next = { ...state, suggestedQuestions }
    logStep(next, 'suggest', 'end', {
      ok: true,
      ms: Date.now() - t0,
      count: suggestedQuestions.length
    })
    return next
  } catch (error) {
    logInfo('Failed to generate suggestions', 'LangGraph', { error })
    logStep(state, 'suggest', 'end', { ok: false, ms: Date.now() - t0, error: String(error) })
    return state
  }
}
