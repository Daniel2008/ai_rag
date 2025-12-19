import { Document } from '@langchain/core/documents'
import { searchSimilarDocumentsWithScores } from './store/index'
import { BM25Searcher } from './store/bm25'
import { logInfo, logDebug, logWarn } from '../utils/logger'

export interface HybridSearchConfig {
  vectorWeight?: number
  keywordWeight?: number
  rerank?: boolean
  topK?: number
  minScore?: number
}

export interface SearchContext {
  query: string
  vectorResults?: { doc: Document; score: number }[]
  keywordResults?: { doc: Document; score: number }[]
  hybridResults?: { doc: Document; finalScore: number; sources: string[] }[]
  processingTime?: number
}

/**
 * 混合检索器 - 结合向量搜索和BM25关键词搜索
 */
export class HybridSearcher {
  private config: HybridSearchConfig
  private bm25: BM25Searcher

  constructor(config: HybridSearchConfig = {}) {
    this.config = {
      vectorWeight: 0.6,
      keywordWeight: 0.4,
      rerank: true,
      topK: 10,
      minScore: 0.1,
      ...config
    }
    this.bm25 = new BM25Searcher()
  }

  /**
   * 执行混合检索
   */
  async search(
    query: string,
    options: {
      sources?: string[]
      limit?: number
    } = {}
  ): Promise<SearchContext> {
    const startTime = Date.now()
    const context: SearchContext = { query }

    try {
      // 1. 向量搜索
      const vectorStart = Date.now()
      const vectorLimit = options.limit || this.config.topK || 10
      
      const vectorResults = await searchSimilarDocumentsWithScores(query, {
        k: vectorLimit,
        sources: options.sources
      })
      
      // 转换为统一格式
      context.vectorResults = vectorResults.map(r => ({
        doc: r.doc,
        score: r.score
      }))
      context.processingTime = Date.now() - startTime

      logDebug('向量搜索完成', 'HybridSearch', {
        query: query.slice(0, 50),
        resultCount: vectorResults.length,
        time: Date.now() - vectorStart,
        topScore: vectorResults[0]?.score.toFixed(3)
      })

      // 2. 关键词搜索（BM25）
      const keywordStart = Date.now()
      
      // 由于BM25Searcher需要完整的LanceDB数据，这里简化为返回空结果
      // 在实际使用中，需要集成BM25索引
      let keywordDocs: { doc: Document; score: number }[] = []
      
      // 如果有向量结果，可以尝试从它们中提取关键词匹配作为简单实现
      if (vectorResults.length > 0) {
        // 简单实现：基于文本匹配的关键词评分
        const queryTerms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2)
        
        if (queryTerms.length > 0) {
          keywordDocs = vectorResults.map(r => {
            const text = (r.doc.pageContent || '').toLowerCase()
            let keywordScore = 0
            queryTerms.forEach(term => {
              if (text.includes(term)) {
                keywordScore += 1
              }
            })
            // 归一化分数
            keywordScore = keywordScore / Math.max(queryTerms.length, 1)
            
            return {
              doc: r.doc,
              score: keywordScore * 0.5 // 缩小分数范围
            }
          }).filter(r => r.score > 0)
        }
      }
      
      context.keywordResults = keywordDocs
      context.processingTime = Date.now() - startTime

      logDebug('关键词搜索完成', 'HybridSearch', {
        query: query.slice(0, 50),
        resultCount: keywordDocs.length,
        time: Date.now() - keywordStart,
        topScore: keywordDocs[0]?.score.toFixed(3)
      })

      // 3. 结果融合
      if (this.config.rerank) {
        context.hybridResults = this.rerankResults(query, vectorResults, keywordDocs)
      } else {
        context.hybridResults = this.simpleFusion(vectorResults, keywordDocs)
      }

      // 4. 过滤低质量结果
      if (this.config.minScore) {
        context.hybridResults = context.hybridResults.filter(r => 
          r.finalScore >= this.config.minScore!
        )
      }

      logInfo('混合检索完成', 'HybridSearch', {
        query: query.slice(0, 50),
        vectorCount: vectorResults.length,
        keywordCount: keywordDocs.length,
        hybridCount: context.hybridResults.length,
        totalTime: context.processingTime
      })

      return context

    } catch (error) {
      logWarn('混合检索失败', 'HybridSearch', { query }, error as Error)
      
      // 降级：只返回向量搜索结果
      if (context.vectorResults && context.vectorResults.length > 0) {
        context.hybridResults = context.vectorResults.map(r => ({
          doc: r.doc,
          finalScore: r.score,
          sources: ['vector']
        }))
        return context
      }

      throw error
    }
  }

  /**
   * 重新排序结果（使用多种策略）
   */
  private rerankResults(
    query: string,
    vectorResults: { doc: Document; score: number }[],
    keywordResults: { doc: Document; score: number }[]
  ): { doc: Document; finalScore: number; sources: string[] }[] {
    const resultsMap = new Map<string, { doc: Document; scores: number[]; sources: string[] }>()

    // 向量结果
    vectorResults.forEach(r => {
      const key = this.getDocKey(r.doc)
      const existing = resultsMap.get(key)
      if (existing) {
        existing.scores.push(r.score)
        existing.sources.push('vector')
      } else {
        resultsMap.set(key, { doc: r.doc, scores: [r.score], sources: ['vector'] })
      }
    })

    // 关键词结果
    keywordResults.forEach(r => {
      const key = this.getDocKey(r.doc)
      const existing = resultsMap.get(key)
      if (existing) {
        existing.scores.push(r.score * 0.1) // 缩小关键词分数范围
        existing.sources.push('keyword')
      } else {
        resultsMap.set(key, { doc: r.doc, scores: [r.score * 0.1], sources: ['keyword'] })
      }
    })

    // 计算最终分数
    const finalResults = Array.from(resultsMap.values()).map(item => {
      // 加权平均
      const vectorScore = item.sources.includes('vector') 
        ? (item.scores[item.sources.indexOf('vector')] || 0) * this.config.vectorWeight!
        : 0
      const keywordScore = item.sources.includes('keyword')
        ? (item.scores[item.sources.indexOf('keyword')] || 0) * this.config.keywordWeight!
        : 0
      
      const finalScore = vectorScore + keywordScore

      return {
        doc: item.doc,
        finalScore,
        sources: item.sources
      }
    })

    // 按分数排序
    return finalResults.sort((a, b) => b.finalScore - a.finalScore)
  }

  /**
   * 简单融合（保留所有结果）
   */
  private simpleFusion(
    vectorResults: { doc: Document; score: number }[],
    keywordResults: { doc: Document; score: number }[]
  ): { doc: Document; finalScore: number; sources: string[] }[] {
    const results: { doc: Document; finalScore: number; sources: string[] }[] = []

    // 添加向量结果
    vectorResults.forEach(r => {
      results.push({
        doc: r.doc,
        finalScore: r.score * this.config.vectorWeight!,
        sources: ['vector']
      })
    })

    // 添加关键词结果
    keywordResults.forEach(r => {
      results.push({
        doc: r.doc,
        finalScore: r.score * 0.1 * this.config.keywordWeight!, // 缩小关键词分数
        sources: ['keyword']
      })
    })

    // 去重
    const seen = new Set<string>()
    const uniqueResults = results.filter(item => {
      const key = this.getDocKey(item.doc)
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    return uniqueResults.sort((a, b) => b.finalScore - a.finalScore)
  }

  /**
   * 生成文档唯一键
   */
  private getDocKey(doc: Document): string {
    const source = doc.metadata?.source || doc.metadata?.filePath || ''
    const chunk = doc.metadata?.chunkIndex || doc.metadata?.position || 0
    return `${source}#${chunk}`
  }

  /**
   * 添加文档到BM25索引
   * 注意：当前版本使用简化实现，此方法为空操作
   */
  async addDocuments(docs: Document[]): Promise<void> {
    // 保留接口兼容性，当前版本不需要显式添加
    void docs
    return Promise.resolve()
  }

  /**
   * 清空BM25索引
   * 注意：当前版本使用简化实现，此方法为空操作
   */
  async clearIndex(): Promise<void> {
    return Promise.resolve()
  }

  /**
   * 获取索引统计
   * 返回空统计，因为当前版本使用简化实现
   */
  getIndexStats() {
    return {
      docCount: 0,
      uniqueTerms: 0,
      avgDocLength: 0,
      message: '当前使用简化的关键词匹配，未使用完整BM25索引'
    }
  }
}

/**
 * 高级检索策略 - 带相关性反馈
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
        limit: options.limit
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
          hybridResults: vectorResults.map(r => ({
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
   * 查询扩展 - 生成相关查询
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

    patterns.forEach(pattern => {
      if (pattern.find.test(query)) {
        const alternatives = pattern.replace.filter(w => !query.includes(w))
        if (alternatives.length > 0) {
          expansions.push(...alternatives.map(w => query.replace(pattern.find, w)))
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

    // 这里可以实现更复杂的反馈逻辑，例如：
    // - 调整权重参数
    // - 更新BM25参数
    // - 记录反馈用于未来优化
  }

  /**
   * 从文档中提取关键词
   */
  private extractKeywords(docs: Document[]): string[] {
    const keywords = new Set<string>()
    const stopWords = new Set(['的', '了', '在', '是', '我', '有', '和', '就', '不', '人', '都', '一', '一个', '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好', '自己', '这'])

    docs.forEach(doc => {
      const text = doc.pageContent.toLowerCase()
      // 提取中文词汇（简单版本）
      const words = text.match(/[\u4e00-\u9fa5]{2,4}/g) || []
      // 提取英文单词
      const enWords = text.match(/[a-zA-Z]{3,}/g) || []
      
      // 合并数组并过滤
      const allWords = [...words, ...enWords]
      allWords.forEach(word => {
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

    docs.forEach(doc => {
      const text = doc.pageContent.toLowerCase()
      // 提取可能不相关的主题词
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
  getStats() {
    const bm25Stats = this.hybridSearcher.getIndexStats()
    return {
      bm25: bm25Stats,
      config: this.hybridSearcher['config']
    }
  }
}

/**
 * 便捷函数：执行混合检索
 */
export async function hybridSearch(
  query: string,
  config?: HybridSearchConfig,
  options?: {
    sources?: string[]
    limit?: number
  }
): Promise<SearchContext> {
  const searcher = new HybridSearcher(config)
  return searcher.search(query, options)
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
