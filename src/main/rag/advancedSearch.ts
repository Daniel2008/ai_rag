import { Document } from '@langchain/core/documents'
import { HybridSearcher, HybridSearchConfig, SearchContext } from './hybridSearch'
import { searchSimilarDocumentsWithScores } from './store/index'
import { logInfo, logWarn } from '../utils/logger'

/**
 * 高级检索策略 - 带相关性反馈和查询扩展
 */
export class AdvancedRetriever {
  private hybridSearcher: HybridSearcher

  constructor(config: HybridSearchConfig = {}) {
    this.hybridSearcher = new HybridSearcher(config)
  }

  /**
   * 执行带上下文增强的检索
   */
  async retrieveWithContext(
    query: string,
    options: {
      sources?: string[]
      limit?: number
      expandQuery?: boolean
      useFallback?: boolean
    } = {}
  ): Promise<{
    context: SearchContext
    expandedQuery?: string
    fallbackUsed: boolean
  }> {
    let finalQuery = query
    let fallbackUsed = false

    // 1. 查询扩展（如果需要）
    if (options.expandQuery) {
      finalQuery = await this.expandQuery(query)
    }

    // 2. 执行混合检索
    let context: SearchContext
    try {
      context = await this.hybridSearcher.search(finalQuery, {
        sources: options.sources,
        limit: options.limit,
        useMultiQuery: options.expandQuery // 如果开启了扩展，优先使用模型驱动的 Multi-Query
      })
    } catch (error) {
      if (options.useFallback) {
        // 降级到简单的向量搜索
        logWarn('混合检索失败，使用向量搜索降级', 'AdvancedRetriever', { query })
        const vectorResults = await searchSimilarDocumentsWithScores(query, {
          k: options.limit || 10,
          sources: options.sources
        })
        context = {
          query,
          vectorResults,
          hybridResults: vectorResults.map((r) => ({
            doc: r.doc,
            finalScore: r.score,
            sources: ['vector-fallback']
          })),
          processingTime: 0
        }
        fallbackUsed = true
      } else {
        throw error
      }
    }

    return {
      context,
      expandedQuery: finalQuery !== query ? finalQuery : undefined,
      fallbackUsed
    }
  }

  /**
   * 传统查询扩展 - 基于关键词匹配的简单扩展
   */
  private async expandQuery(query: string): Promise<string> {
    // 简单的查询扩展策略
    const expansions: string[] = [query]

    // 添加同义词扩展（基于常见模式）
    const patterns = [
      { find: /技术|科技/g, replace: ['技术', '科技', '工程技术'] },
      { find: /产品/g, replace: ['产品', '产品开发', '产品设计'] },
      { find: /项目/g, replace: ['项目', '项目管理', '项目实施'] }
    ]

    patterns.forEach((pattern) => {
      if (pattern.find.test(query)) {
        const alternatives = pattern.replace.filter((w) => !query.includes(w))
        if (alternatives.length > 0) {
          expansions.push(...alternatives.map((w) => query.replace(pattern.find, w)))
        }
      }
    })

    // 如果查询较短，添加常见扩展词
    if (query.length < 10) {
      expansions.push(query + ' 管理')
      expansions.push(query + ' 系统')
      expansions.push(query + ' 方案')
    }

    return expansions.join(' OR ')
  }

  /**
   * 相关性反馈 - 基于用户反馈优化检索
   */
  async feedbackRelevance(
    query: string,
    relevantDocs: Document[],
    irrelevantDocs: Document[]
  ): Promise<void> {
    // 从相关文档中提取关键词
    const relevantKeywords = this.extractKeywords(relevantDocs)

    // 从不相关文档中提取应避免的模式
    const irrelevantPatterns = this.extractPatterns(irrelevantDocs)

    logInfo('收到相关性反馈', 'AdvancedRetriever', {
      query: query.slice(0, 50),
      relevantCount: relevantDocs.length,
      irrelevantCount: irrelevantDocs.length,
      extractedKeywords: relevantKeywords.slice(0, 5),
      avoidedPatterns: irrelevantPatterns.slice(0, 3)
    })
  }

  /**
   * 从文档中提取关键词
   */
  private extractKeywords(docs: Document[]): string[] {
    const keywords = new Set<string>()
    const stopWords = new Set([
      '的',
      '了',
      '在',
      '是',
      '我',
      '有',
      '和',
      '就',
      '不',
      '人',
      '都',
      '一',
      '一个',
      '上',
      '也',
      '很',
      '到',
      '说',
      '要',
      '去',
      '你',
      '会',
      '着',
      '没有',
      '看',
      '好',
      '自己',
      '这'
    ])

    docs.forEach((doc) => {
      const text = doc.pageContent.toLowerCase()
      const words = text.match(/[\u4e00-\u9fa5]{2,4}/g) || []
      const enWords = text.match(/[a-zA-Z]{3,}/g) || []

      const allWords = [...words, ...enWords]
      allWords.forEach((word) => {
        if (!stopWords.has(word) && word.length > 1) {
          keywords.add(word)
        }
      })
    })

    return Array.from(keywords).slice(0, 20)
  }

  /**
   * 提取不相关模式
   */
  private extractPatterns(docs: Document[]): string[] {
    const patterns = new Set<string>()

    docs.forEach((doc) => {
      const text = doc.pageContent.toLowerCase()
      const topics = text.match(/[\u4e00-\u9fa5]{2,6}/g) || []
      topics.forEach((topic: string) => {
        if (topic.length > 2) {
          patterns.add(topic)
        }
      })
    })

    return Array.from(patterns)
  }

  /**
   * 获取检索器统计信息
   */
  getStats(): { bm25: ReturnType<HybridSearcher['getIndexStats']>; config: HybridSearchConfig } {
    const bm25Stats = this.hybridSearcher.getIndexStats()
    return {
      bm25: bm25Stats,
      config: (this.hybridSearcher as any).config
    }
  }
}

/**
 * 便捷函数：执行高级检索
 */
export async function advancedSearch(
  query: string,
  config?: HybridSearchConfig,
  options?: {
    sources?: string[]
    limit?: number
    expandQuery?: boolean
    useFallback?: boolean
  }
): ReturnType<AdvancedRetriever['retrieveWithContext']> {
  const retriever = new AdvancedRetriever(config)
  return retriever.retrieveWithContext(query, options)
}
