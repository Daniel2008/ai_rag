import { ChatGraphState } from '../state'
import { logStep } from './preprocess'
import { getConversationMemory, upsertConversationMemory } from '../../../db/service'
import { updateConversationMemory } from '../../chat'

export async function memoryLoad(state: ChatGraphState): Promise<ChatGraphState> {
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

export async function memoryUpdate(state: ChatGraphState): Promise<ChatGraphState> {
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
