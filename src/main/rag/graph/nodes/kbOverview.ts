import { ChatGraphState } from '../state'
import { logStep } from './preprocess'
import { getSnapshot } from '../../knowledgeBase/core'
import { logInfo } from '../../../utils/logger'

/**
 * 知识库概览节点
 * 当用户询问知识库里有什么、有哪些文档等问题时触发
 */
export async function kbOverview(state: ChatGraphState): Promise<ChatGraphState> {
  const t0 = Date.now()
  logStep(state, 'kbOverview', 'start')

  try {
    const snapshot = getSnapshot()

    const totalFiles = snapshot.files.length
    const totalChunks = snapshot.files.reduce((sum, f) => sum + (f.chunkCount || 0), 0)

    // 简单的标签统计
    const tagStats: Record<string, number> = {}
    snapshot.files.forEach((f) => {
      f.tags?.forEach((tagId) => {
        tagStats[tagId] = (tagStats[tagId] || 0) + 1
      })
    })

    // 构建概览上下文
    let overview = `[知识库概览信息]\n`
    overview += `- 总文件数: ${totalFiles}\n`
    if (totalChunks > 0) overview += `- 总分块数: ${totalChunks}\n`

    const availableTags = snapshot.availableTags || []
    if (Object.keys(tagStats).length > 0) {
      overview += `\n[标签分布]:\n`
      Object.entries(tagStats).forEach(([tagId, count]) => {
        const tagName = availableTags.find((t) => t.id === tagId)?.name || tagId
        overview += `- ${tagName}: ${count} 个文件\n`
      })
    }

    const recentFiles = [...snapshot.files]
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 5)

    if (recentFiles.length > 0) {
      overview += `\n[最近更新的文件]:\n`
      recentFiles.forEach((f) => {
        overview += `- ${f.name} (${new Date(f.updatedAt || 0).toLocaleDateString()})\n`
      })
    }

    const next = {
      ...state,
      context: (state.context || '') + '\n\n' + overview,
      kbOverviewData: { totalFiles, totalChunks, tagStats }
    }

    logStep(next, 'kbOverview', 'end', { ok: true, ms: Date.now() - t0 })
    return next
  } catch (error) {
    logInfo('Failed to generate KB overview', 'LangGraph', { error })
    logStep(state, 'kbOverview', 'end', { ok: false, ms: Date.now() - t0, error: String(error) })
    return state
  }
}
