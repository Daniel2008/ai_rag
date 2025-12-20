import { Document } from '@langchain/core/documents'
import { searchSimilarDocumentsWithScores, getVectorTable } from './store/index'
import { getBM25Searcher } from './store/bm25'
import { reciprocalRankFusion } from './store/algorithms'
import { rerank } from './localReranker'
import { queryExpander } from './queryExpander'
import { logDebug, logWarn } from '../utils/logger'
import { RAG_CONFIG } from '../utils/config'
import { getSettings } from '../settings'
import type { LanceDBSearchResult } from './store/types'

export interface HybridSearchConfig {
  vectorWeight?: number
  keywordWeight?: number
  rerank?: boolean
  multiQuery?: boolean
  topK?: number
  minScore?: number
  rrfK?: number
  rerankTopK?: number
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

  constructor(config: HybridSearchConfig = {}) {
    const settings = getSettings()
    
    // 显式解析 rerank 配置，确保布尔值正确传递
    // 如果 config.rerank 明确传入（即使是 false），则使用它
    // 否则回退到 settings 中的配置
    const useRerank = config.rerank !== undefined ? config.rerank : (settings.rag?.useRerank ?? false)
    
    this.config = {
      vectorWeight: 0.7,
      keywordWeight: 0.3,
      multiQuery: config.multiQuery ?? settings.rag?.useMultiQuery ?? false,
      topK: 10,
      minScore: 0.1,
      rrfK: RAG_CONFIG.CROSS_LANGUAGE?.RRF_K || 60,
      rerankTopK: RAG_CONFIG.RERANK?.TOP_K || 5,
      ...config,
      // 确保 rerank 属性被正确设置，覆盖 ...config 中的可能 undefined
      rerank: useRerank
    }
    
    logDebug('HybridSearcher initialized', 'HybridSearch', {
      rerank: this.config.rerank,
      multiQuery: this.config.multiQuery,
      configSource: config.rerank !== undefined ? 'manual' : 'settings',
      settingsRerank: settings.rag?.useRerank
    })
  }

  getConfig(): HybridSearchConfig {
    return this.config
  }

  /**
   * 执行混合检索
   */
  async search(
    query: string,
    options: {
      sources?: string[]
      tags?: string[]
      limit?: number
      useMultiQuery?: boolean
    } = {}
  ): Promise<SearchContext> {
    const startTime = Date.now()
    const context: SearchContext = { query }
    const limit = options.limit || this.config.topK || 10

    // 1. 查询扩展 (Multi-Query)
    let queries = [query]
    if (options.useMultiQuery || this.config.multiQuery) {
      queries = await queryExpander.expandQuery(query, 3)
    }

    try {
      // 对每个查询并行执行检索
      const allResults = await Promise.all(
        queries.map(async (q) => {
          // a. 获取向量搜索结果
          const vectorResultsRaw = await searchSimilarDocumentsWithScores(q, {
            k: limit,
            sources: options.sources,
            tags: options.tags
          })

          // b. 关键词搜索 (BM25)
          let keywordDocs: { doc: Document; score: number }[] = []
          const table = await getVectorTable()
          if (table) {
            try {
              let lancedbDocs: LanceDBSearchResult[] = []
              const queryBuilder = table.query()

              // 这里的 limit(2000) 只是为了 BM25 构建临时的索引
              lancedbDocs = (await queryBuilder.limit(2000).toArray()) as LanceDBSearchResult[]

              if (
                (options.sources && options.sources.length > 0) ||
                (options.tags && options.tags.length > 0)
              ) {
                const sourceSet = options.sources ? new Set(options.sources) : null
                const tagSet = options.tags ? new Set(options.tags) : null

                lancedbDocs = lancedbDocs.filter((d) => {
                  const s = d.source || d.metadata?.source
                  const t = (d.tags || d.metadata?.tags) as string[]

                  const sourceMatch = !sourceSet || (s && sourceSet.has(s))
                  const tagMatch = !tagSet || (t && t.some((tag) => tagSet.has(tag)))

                  return !!(sourceMatch && tagMatch)
                })
              }

              if (lancedbDocs.length > 0) {
                const bm25Searcher = await getBM25Searcher(lancedbDocs)
                const bm25Results = bm25Searcher.search(q, limit)
                keywordDocs = bm25Results.map((r) => ({
                  doc: new Document({
                    pageContent: r.result.text || r.result.pageContent || '',
                    metadata: r.result.metadata || { source: r.result.source }
                  }),
                  score: r.score
                }))
              }
            } catch (e) {
              logWarn('BM25 搜索失败', 'HybridSearch', { query: q }, e as Error)
            }
          }

          return { vectorResults: vectorResultsRaw, keywordResults: keywordDocs }
        })
      )

      context.vectorResults = allResults[0].vectorResults.map((r) => ({
        doc: r.doc,
        score: r.score
      }))
      context.keywordResults = allResults[0].keywordResults

      // 2. 结果融合 (RRF) - 支持多查询结果融合
      const docKeyMap = new Map<string, Document>()
      const getDocKey = (doc: Document) => {
        const key = `${doc.metadata?.source || ''}:${doc.pageContent.slice(0, 100)}`
        if (!docKeyMap.has(key)) docKeyMap.set(key, doc)
        return key
      }

      // RRF 融合：向量结果列表 + 关键词结果列表
      // 在多查询模式下，这里包含了所有查询的结果
      const vectorLists = allResults.map((r) => r.vectorResults.map((vr) => vr.doc))
      const keywordLists = allResults.map((r) => r.keywordResults.map((kr) => kr.doc))

      const fused = reciprocalRankFusion(
        [...vectorLists, ...keywordLists].filter((l) => l.length > 0),
        getDocKey,
        this.config.rrfK || 60
      )

      context.hybridResults = fused.slice(0, limit * 2).map((f) => {
        const sources: string[] = []
        const currentKey = getDocKey(f.item)
        // 判断来源：如果出现在任何一个查询的向量结果中，则标记为 vector
        if (vectorLists.some((list) => list.some((d) => getDocKey(d) === currentKey)))
          sources.push('vector')
        // 判断来源：如果出现在任何一个查询的关键词结果中，则标记为 keyword
        if (keywordLists.some((list) => list.some((d) => getDocKey(d) === currentKey)))
          sources.push('keyword')

        return {
          doc: f.item,
          finalScore: f.score,
          sources
        }
      })

      // 3. 重排序 (Cross-Encoder)
      if (this.config.rerank && context.hybridResults && context.hybridResults.length > 0) {
        const rerankStart = Date.now()
        try {
          const currentHybridResults = context.hybridResults
          const docsToRerank = currentHybridResults.map((r) => r.doc.pageContent)
          
          logDebug('Starting rerank', 'HybridSearch', {
            docsCount: docsToRerank.length,
            model: RAG_CONFIG.RERANK.MODEL
          })

          const rerankResults = await rerank(query, docsToRerank, {
            topK: this.config.rerankTopK
          })

          context.hybridResults = rerankResults.map((res) => {
            const original = currentHybridResults[res.index]
            return {
              doc: original.doc,
              finalScore: res.score,
              sources: original.sources
            }
          })

          logDebug('重排序完成', 'HybridSearch', {
            count: context.hybridResults.length,
            time: Date.now() - rerankStart
          })
        } catch (e) {
          logWarn('重排序失败，跳过', 'HybridSearch', undefined, e as Error)
        }
      }

      // 4. 过滤低质量结果
      if (this.config.minScore && context.hybridResults) {
        context.hybridResults = context.hybridResults.filter(
          (r) => r.finalScore >= this.config.minScore!
        )
      }

      context.processingTime = Date.now() - startTime
      return context
    } catch (error) {
      logWarn('混合检索失败', 'HybridSearch', { query }, error as Error)
      // 降级：返回原始向量搜索结果
      const vectorResultsRaw = await searchSimilarDocumentsWithScores(query, {
        k: limit,
        sources: options.sources,
        tags: options.tags
      })
      context.hybridResults = vectorResultsRaw.map((r) => ({
        doc: r.doc,
        finalScore: r.score,
        sources: ['vector-fallback']
      }))
      return context
    }
  }

  /**
   * 添加文档到BM25索引
   */
  async addDocuments(docs: Document[]): Promise<void> {
    void docs
    return Promise.resolve()
  }

  /**
   * 清空BM25索引
   */
  async clearIndex(): Promise<void> {
    return Promise.resolve()
  }

  /**
   * 获取索引统计
   */
  getIndexStats(): {
    docCount: number
    uniqueTerms: number
    avgDocLength: number
    message: string
  } {
    return {
      docCount: 0,
      uniqueTerms: 0,
      avgDocLength: 0,
      message: 'BM25 索引动态构建'
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
    tags?: string[]
    limit?: number
  }
): Promise<SearchContext> {
  const searcher = new HybridSearcher(config)
  return searcher.search(query, options)
}
