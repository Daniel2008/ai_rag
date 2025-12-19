import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { RunnableSequence } from '@langchain/core/runnables'
import { createChatModel } from '../utils/createChatModel'
import { getSettings } from '../settings'
import { logDebug, logWarn } from '../utils/logger'

/**
 * 查询扩展器 - 将用户问题改写为多个相关的查询以提高检索召回率
 */
export class QueryExpander {
  /**
   * 生成多个相关的查询
   * @param query 原始查询
   * @param count 生成的数量
   */
  async expandQuery(query: string, count: number = 3): Promise<string[]> {
    try {
      const settings = getSettings()
      const model = createChatModel(settings.provider)

      const template = `你是一个 AI 语言模型助手。你的任务是生成 {count} 个不同版本的用户查询，以从向量数据库中检索相关文档。
通过从不同角度提出多个查询，你的目标是帮助用户克服基于距离的相似性搜索的一些局限性。

用户查询：{query}

请直接输出生成的查询，每行一个，不要包含任何编号、说明或其它文字。
生成的查询应该是简洁且与原意相关的中文。`

      const prompt = PromptTemplate.fromTemplate(template)
      const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

      const result = await chain.invoke({
        query,
        count
      })

      const queries = result
        .split('\n')
        .map((q) => q.trim())
        .filter((q) => q.length > 0)
        .slice(0, count)

      // 始终包含原始查询
      if (!queries.includes(query)) {
        queries.unshift(query)
      }

      logDebug('查询扩展完成', 'QueryExpander', {
        original: query,
        expanded: queries
      })

      return queries
    } catch (error) {
      logWarn('查询扩展失败，返回原始查询', 'QueryExpander', { query }, error as Error)
      return [query]
    }
  }
}

export const queryExpander = new QueryExpander()
