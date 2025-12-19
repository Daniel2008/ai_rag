import { createChatModel } from '../utils/createChatModel'
import { getSettings } from '../settings'
import { logDebug } from '../utils/logger'

export interface AnalysisOptions {
  type?: 'summary' | 'entity_extraction' | 'key_points' | 'comprehensive'
  maxChunks?: number
}

/**
 * 长文分析类
 */
export class LongContextAnalyzer {
  private model: any

  constructor() {
    const settings = getSettings()
    this.model = createChatModel(settings.provider)
  }

  /**
   * 对长文本进行分析（采用 Map-Reduce 策略）
   */
  async analyze(content: string, options: AnalysisOptions = {}): Promise<string> {
    const { type = 'comprehensive', maxChunks = 10 } = options

    // 1. 分块 (假设每块 4000 字符)
    const chunkSize = 4000
    const chunks: string[] = []
    for (let i = 0; i < content.length && chunks.length < maxChunks; i += chunkSize) {
      chunks.push(content.slice(i, i + chunkSize))
    }

    if (chunks.length <= 1) {
      return this.directAnalyze(content, type)
    }

    logDebug(`LongContextAnalyzer: Analyzing ${chunks.length} chunks`, 'LongContext')

    // 2. Map 阶段：并行分析每一块
    const mapPrompts = chunks.map((chunk, idx) => {
      return `你是一个专业的文档分析师。请对以下文档片段进行分析（片段 ${idx + 1}/${chunks.length}）。
分析要求：${this.getPromptByType(type)}

文档片段：
---
${chunk}
---`
    })

    const mapResults = await Promise.all(
      mapPrompts.map(async (prompt) => {
        const res = await this.model.invoke(prompt)
        return typeof res === 'string' ? res : res.content
      })
    )

    // 3. Reduce 阶段：汇总分析结果
    const reducePrompt = `你是一个专业的文档分析师。请根据以下对文档各部分的初步分析结果，生成一份最终的完整分析报告。
分析类型：${type === 'summary' ? '全文摘要' : '综合分析报告'}
汇总要求：逻辑清晰，重点突出，消除重复信息。

初步分析结果：
---
${mapResults.join('\n\n---\n\n')}
---`

    const finalResult = await this.model.invoke(reducePrompt)
    return typeof finalResult === 'string' ? finalResult : finalResult.content
  }

  private async directAnalyze(content: string, type: string): Promise<string> {
    const prompt = `请对以下文档进行分析：
分析要求：${this.getPromptByType(type)}

文档内容：
---
${content}
---`
    const res = await this.model.invoke(prompt)
    return typeof res === 'string' ? res : res.content
  }

  private getPromptByType(type: string): string {
    switch (type) {
      case 'summary':
        return '请提取该片段的核心摘要，保留关键事实和结论。'
      case 'entity_extraction':
        return '请提取该片段中的关键实体（人名、地名、机构、专业术语等）及其简要说明。'
      case 'key_points':
        return '请列出该片段的 3-5 个核心要点。'
      case 'comprehensive':
      default:
        return '请总结该片段的主要内容、核心观点和重要细节。'
    }
  }
}
