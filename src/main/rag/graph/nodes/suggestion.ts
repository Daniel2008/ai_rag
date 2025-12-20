import { ChatGraphState } from '../state'
import { logStep } from './preprocess'
import { SmartPromptGenerator } from '../../smartFeatures'
import { logInfo } from '../../../utils/logger'
import { BrowserWindow } from 'electron'

/**
 * 建议节点
 * 在生成回答后，生成相关的后续问题建议
 */
export async function suggest(state: ChatGraphState): Promise<ChatGraphState> {
  // 如果已经有建议或者出错了，跳过
  if (state.suggestedQuestions?.length || state.error || !state.answer) {
    return state
  }

  // 立即返回，不阻塞流程
  // 实际上 LangGraph 必须等待 Promise resolve。
  // 但如果我们在 node 内部不等待异步操作呢？
  // 不行，如果后续节点依赖它。
  // 这里 suggest 的结果后续只有 memoryUpdate，而 memoryUpdate 并不依赖 suggestedQuestions。
  // 但是整个 graph 的输出依赖它。
  // 如果我们想让前端先收到 "done" 信号，我们需要在 invoke 之外处理。
  // 或者，我们在 generate 结束时就发送一个 done 信号（如果前端支持）？
  // 前端 ElectronXRequest 等待的是 type: 'done'。

  const t0 = Date.now()
  logStep(state, 'suggest', 'start')

  try {
    // 异步生成建议并通过 IPC 推送
    const doSuggest = async () => {
      try {
        // 快速生成建议（降低数量和复杂度）
        const generator = new SmartPromptGenerator()
        // 减少 context 长度，不传 state.context 以加速
        const context = `问题: ${state.question}\n回答: ${state.answer}`

        const suggestedQuestions = await generator.generatePrompts(context, {
          count: 3,
          tone: 'professional'
        })

        // 通过 IPC 直接推送给前端
        // 注意：这里需要一种机制知道往哪个窗口发，或者广播
        const wins = BrowserWindow.getAllWindows()
        if (wins.length > 0) {
          // 假设主窗口是第一个
          wins[0].webContents.send('rag:chat-suggestions', suggestedQuestions)
        }
      } catch (e) {
        logInfo('Background suggestion generation failed', 'LangGraph', { error: e })
      }
    }

    // 触发后台生成
    doSuggest()
   
    const next = { ...state }

    logStep(next, 'suggest', 'end', {
      ok: true,
      ms: Date.now() - t0,
      count: 0,
      async: true
    })
    return next
  } catch (error) {
    logInfo('Failed to generate suggestions', 'LangGraph', { error })
    logStep(state, 'suggest', 'end', { ok: false, ms: Date.now() - t0, error: String(error) })
    return state
  }
}
