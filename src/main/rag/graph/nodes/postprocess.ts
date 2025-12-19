import { ChatGraphState } from '../state'
import { logStep } from './preprocess'

export async function postcheck(state: ChatGraphState): Promise<ChatGraphState> {
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
export async function groundingCheck(state: ChatGraphState): Promise<ChatGraphState> {
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
export function shouldRegenerate(state: ChatGraphState): string {
  if (state.error) return 'suggest'
  // 如果引用失效且重试次数少于 1 次，则重试
  if (state.groundingStatus === 'invalid_citations' && (state.retryCount || 0) < 1) {
    return 'generate'
  }
  return 'suggest'
}
