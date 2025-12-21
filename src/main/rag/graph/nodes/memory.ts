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

    // 异步执行记忆更新，不等待结果
    // 注意：这样会导致 memory 状态在本次请求中没有更新到 state 中，
    // 但对于下一个请求来说，只要数据库更新了就行。
    // 不过 LangGraph 的状态流转是同步等待 Promise 的。
    // 如果我们返回一个 Promise 但不 await 内部的耗时操作...
    // 但是我们需要 updateConversationMemory 的结果来存库。

    // 权衡：为了用户体验，我们可以接受这里的延迟，或者简化 updateConversationMemory。
    // 目前 updateConversationMemory 会调用 LLM 进行压缩。
    // 我们可以将其放入后台执行（不 await），但这在 Serverless/Lambda 环境可能有问题，
    // 但在 Electron 本地环境通常是可以的，只要进程不退出。

    const doUpdate = async () => {
      try {
        const nextMemory = await updateConversationMemory(
          state.memory || null,
          state.question,
          state.answer!
        )
        if (nextMemory.trim()) {
          upsertConversationMemory(state.conversationKey!, nextMemory)
        }
      } catch (e) {
        console.warn('Background memory update failed', e)
      }
    }

    // 触发后台更新
    doUpdate()

    // 立即返回旧状态（或者我们可以假设更新成功，但在 LangGraph 中最好保持状态一致性）
    // 这里我们选择不阻塞 UI，所以立即返回。
    const next = { ...state } // memory 字段保持不变，或者我们在后台更新
    logStep(next, 'memoryUpdate', 'end', { ok: true, ms: Date.now() - t0, updated: 'background' })
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
