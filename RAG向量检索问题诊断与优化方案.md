# RAG 向量检索问题诊断与优化方案

## 一、问题分析

### 1. 性能瓶颈问题

#### 问题点：
- **全量数据加载**：`searchByFileName` 函数加载2000条记录，`BM25搜索`加载5000条记录
- **重复转换**：多次在 `searchSimilarDocumentsWithScores` 和 `hybridSearch` 之间转换数据格式
- **嵌入查询未优化**：每次查询都重新计算向量，未充分利用缓存

#### 影响：
- 内存占用高，响应延迟
- 并发查询时性能下降
- 大文档集合检索缓慢

### 2. 检索质量问题

#### 问题点：
- **相关性过滤过严**：`filterByRelevanceThreshold` 会过滤掉语义相关但词汇不同的结果
- **跨语言匹配缺陷**：关键词匹配在跨语言查询时失效
- **融合算法权重**：RRF参数可能需要调整

#### 影响：
- 漏检有用文档
- 英文查询中文文档时召回率低
- 多源检索结果融合不理想

### 3. 配置问题

#### 问题点：
- `RERANK.ENABLED: false` 默认关闭重排序
- `MMR_ENABLED: true` 但可能计算成本高
- `SEARCH.MAX_K: 30` 限制可能过大

### 4. 缓存策略问题

#### 问题点：
- 查询向量缓存大小256可能不足
- 文档计数缓存60秒可能太短
- 混合搜索时缓存未有效利用

## 二、优化方案

### 1. 性能优化

#### 1.1 限制全量扫描范围
```typescript
// 优化 searchByFileName
export async function searchByFileName(
  tableRef: Table,
  query: string,
  limit: number
): Promise<FileNameSearchResult> {
  const keywords = extractFileNameKeywords(query)
  if (keywords.length === 0) return { results: [], matchedKeywords: [] }

  // 限制初始扫描数量，改为流式处理
  const scanLimit = Math.min(500, limit * 50) // 限制扫描范围
  const allRows = (await tableRef.query().limit(scanLimit).toArray()) as LanceDBSearchResult[]
  
  // ... 其余逻辑不变
}

// 优化 BM25 索引构建
const maxBM25Rows = 1000 // 替代原来的5000
if (allDocsForBM25.length > maxBM25Rows) {
  // 使用采样策略
  const step = Math.ceil(allDocsForBM25.length / maxBM25Rows)
  allDocsForBM25 = allDocsForBM25.filter((_, idx) => idx % step === 0)
}
```

#### 1.2 减少数据转换
```typescript
// 优化搜索流程，减少中间转换
export async function searchSimilarDocumentsWithScores(
  query: string,
  options: SearchOptions,
  getDocCountCached: () => Promise<number>,
  getQueryVector: (query: string, embeddings: Embeddings) => Promise<number[]>
): Promise<ScoredDocument[]> {
  // ... 前面的逻辑保持不变
  
  // 合并阶段直接返回，避免多次转换
  if (resultLists.length > 1) {
    const rrfResults = reciprocalRankFusion(resultLists, getResultKey, RAG_CONFIG.CROSS_LANGUAGE.RRF_K)
    // 直接转换为最终格式
    return rrfResults.slice(0, k).map(({ item, score }) => ({
      doc: convertToScoredDocuments([item])[0].doc,
      score: distanceToScore(item._distance ?? 1 / (score + 1))
    }))
  }
  
  // ... 其余逻辑
}
```

#### 1.3 优化向量缓存
```typescript
// 扩大缓存大小
export const queryEmbeddingCache = new LRUCache<string, number[]>(
  RAG_CONFIG.EMBEDDING.QUERY_CACHE_SIZE * 2, // 从256扩展到512
  10 * 60 * 1000 // 延长到10分钟
)

// 添加相似查询缓存
export async function getCachedOrComputeVector(
  query: string, 
  embeddings: Embeddings,
  similarityThreshold: number = 0.95
): Promise<number[]> {
  // 先查精确匹配
  const cached = queryEmbeddingCache.get(query)
  if (cached) return cached
  
  // 查相似查询
  const allKeys = queryEmbeddingCache.keys()
  for (const key of allKeys) {
    const similarity = stringSimilarity(key, query)
    if (similarity >= similarityThreshold) {
      return queryEmbeddingCache.get(key)!
    }
  }
  
  // 计算新的向量
  const vec = await embeddings.embedQuery(query)
  queryEmbeddingCache.set(query, vec)
  return vec
}
```

### 2. 检索质量优化

#### 2.1 修正相关性过滤
```typescript
export function filterByRelevanceThreshold<T extends { score: number; doc: Document }>(
  results: T[],
  query: string, // 保留query参数用于日志和调试
  threshold: number = RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD
): T[] {
  if (results.length === 0) return results

  // 向量搜索已经是语义匹配，只需按分数阈值过滤
  const scoreFiltered = results.filter((r) => r.score >= threshold)

  // 如果过滤后结果太少，按以下策略处理：
  if (scoreFiltered.length < 3) {
    const lowThreshold = Math.min(threshold, RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD_LOW)
    
    // 策略1: 使用更低阈值
    const relaxedResults = results.filter((r) => r.score >= lowThreshold)
    if (relaxedResults.length >= 2) {
      logDebug('Using relaxed threshold', 'Search', {
        originalThreshold: threshold,
        relaxedThreshold: lowThreshold,
        results: relaxedResults.length
      })
      return relaxedResults
    }

    // 策略2: 排序后取前N个（不考虑阈值）
    if (results.length > 0) {
      const topResults = results
        .sort((a, b) => b.score - a.score)
        .slice(0, Math.max(5, Math.ceil(results.length * 0.3)))
      
      logDebug('Using top results without threshold', 'Search', {
        threshold,
        resultCount: topResults.length,
        minScore: topResults[topResults.length - 1].score
      })
      return topResults
    }
  }

  return scoreFiltered
}
```

#### 2.2 改进跨语言检索
```typescript
// 在 performCrossLanguageSearch 中添加查询变体生成
export async function performCrossLanguageSearch(
  tableRef: Table,
  query: string,
  embeddings: Embeddings,
  fetchK: number,
  getQueryVector: (query: string, embeddings: Embeddings) => Promise<number[]>,
  whereClause?: string
): Promise<LanceDBSearchResult[]> {
  const { detectLanguage, generateCrossLanguageQueries } = await import('../queryTranslator')
  const queryLang = detectLanguage(query)

  if (queryLang !== 'zh') {
    const queryVector = await getQueryVector(query, embeddings)
    return await performNativeSearch(tableRef, queryVector, fetchK, whereClause)
  }

  logDebug('Detected Chinese query, attempting cross-language search', 'Search')

  try {
    // 1. 生成跨语言查询变体
    const { queries, original, translated } = await generateCrossLanguageQueries(query)
    
    // 2. 为每个变体生成向量
    const searchPromises = queries.map(async (q, index) => {
      const vector = await getQueryVector(q, embeddings)
      const results = await performNativeSearch(tableRef, vector, fetchK, whereClause)
      
      logDebug(`Query variant ${index + 1}`, 'Search', {
        query: q.slice(0, 30),
        lang: detectLanguage(q),
        results: results.length
      })
      
      return results
    })

    const allResultLists = await Promise.all(searchPromises)

    // 3. 使用RRF融合（保留原始分数信息）
    const getResultKey = (r: LanceDBSearchResult): string => {
      const content = r.text || r.pageContent || ''
      const source = r.source || r.metadata?.source || ''
      return `${source}::${content}`
    }

    const rrfResults = reciprocalRankFusion(allResultLists, getResultKey, RAG_CONFIG.CROSS_LANGUAGE.RRF_K)

    // 4. 转换为最终格式
    const finalResults = rrfResults.slice(0, fetchK).map(({ item, score }) => ({
      ...item,
      _distance: 1 / (score + 1),
      _rrfScore: score,
      _queryVariants: queries // 保留查询变体信息
    }))

    logDebug('Cross-language search completed', 'Search', {
      originalQuery: original,
      translatedQuery: translated,
      variantsCount: queries.length,
      resultCount: finalResults.length,
      rrfScoreRange: {
        max: rrfResults[0]?.score ?? 0,
        min: rrfResults[rrfResults.length - 1]?.score ?? 0
      }
    })

    return finalResults
  } catch (error) {
    logWarn('Cross-language search failed, using original query', 'Search', undefined, error as Error)
    const queryVector = await getQueryVector(query, embeddings)
    return await performNativeSearch(tableRef, queryVector, fetchK, whereClause)
  }
}
```

#### 2.3 调整融合参数
```typescript
// 配置优化
export const RAG_CONFIG = {
  // ... 其他配置
  
  SEARCH: {
    // ... 其他搜索配置
    RELEVANCE_THRESHOLD: 0.15, // 从0.25降低，减少误过滤
    RELEVANCE_THRESHOLD_LOW: 0.05, // 更宽松的阈值
    
    // RRF参数调整
    RRF_K: 60, // 标准值，可根据需要调整为40-80
    
    // MMR参数
    MMR_LAMBDA: 0.7, // 从0.75调整，增加多样性
    MMR_ENABLED: true,
    
    // 混合搜索权重
    HYBRID_SEARCH_ENABLED: true,
    BM25_WEIGHT: 0.5, // 调整为更平衡
    VECTOR_WEIGHT: 0.5
  },
  
  RERANK: {
    ...RAG_CONFIG.RERANK,
    ENABLED: true // 默认启用重排序（如果有本地模型）
  },
  
  EMBEDDING: {
    ...RAG_CONFIG.EMBEDDING,
    QUERY_CACHE_SIZE: 512, // 从256扩大
    QUERY_CACHE_TTL: 600000, // 从5分钟延长到10分钟
    SIMILAR_QUERY_THRESHOLD: 0.92 // 从0.95调整，更宽松
  }
}
```

### 3. 混合搜索优化

#### 3.1 优化混合搜索流程
```typescript
export class HybridSearcher {
  async search(query: string, options: HybridSearchOptions = {}): Promise<SearchContext> {
    const startTime = Date.now()
    const context: SearchContext = { query }
    const limit = options.limit || this.config.topK || 10

    // 1. 查询扩展（有条件）
    let queries = [query]
    const shouldUseMultiQuery = options.useMultiQuery || this.config.multiQuery
    if (shouldUseMultiQuery) {
      const complexity = estimateQueryComplexity(query)
      // 只对复杂查询使用扩展
      if (complexity > 0.3) {
        queries = await queryExpander.expandQuery(query, 3)
        logDebug('Multi-query enabled for complex query', 'HybridSearch', {
          complexity: complexity.toFixed(2),
          variants: queries.length
        })
      }
    }

    try {
      // 2. 并行搜索 - 优化数据获取
      const allResults = await Promise.all(
        queries.map(async (q) => {
          // a. 向量搜索
          const vectorSearchPromise = searchSimilarDocumentsWithScores(q, {
            k: limit,
            sources: options.sources,
            tags: options.tags
          })

          // b. 关键词搜索（并行执行）
          const keywordSearchPromise = this.performKeywordSearch(q, limit, options)

          const [vectorResults, keywordDocs] = await Promise.all([
            vectorSearchPromise,
            keywordSearchPromise
          ])

          return { vectorResults, keywordResults: keywordDocs }
        })
      )

      // 3. 结果融合 - 优化key生成
      const docKeyMap = new Map<string, Document>()
      const getDocKey = (doc: Document) => {
        // 使用更精确的key生成策略
        const source = doc.metadata?.source || ''
        const contentHash = doc.pageContent.slice(0, 200).replace(/\s+/g, '').slice(0, 50)
        return `${source}::${doc.metadata?.page || 0}::${contentHash}`
      }

      // 4. RRF融合 - 调整算法
      const vectorLists = allResults.map((r) => r.vectorResults.map((vr) => vr.doc))
      const keywordLists = allResults.map((r) => r.keywordResults.map((kr) => kr.doc))

      const fused = reciprocalRankFusion(
        [...vectorLists, ...keywordLists].filter((l) => l.length > 0),
        getDocKey,
        this.config.rrfK || 60
      )

      // 5. 重排序（如果启用）
      let finalResults = fused.slice(0, limit * 2).map((f) => {
        const sources: string[] = []
        const currentKey = getDocKey(f.item)
        
        // 标记来源
        if (vectorLists.some((list) => list.some((d) => getDocKey(d) === currentKey))) {
          sources.push('vector')
        }
        if (keywordLists.some((list) => list.some((d) => getDocKey(d) === currentKey))) {
          sources.push('keyword')
        }

        return {
          doc: f.item,
          finalScore: f.score,
          sources
        }
      })

      // 6. 重排序
      if (this.config.rerank && finalResults.length > 0) {
        try {
          const docsToRerank = finalResults.map((r) => r.doc.pageContent)
          const rerankResults = await rerank(query, docsToRerank, {
            topK: this.config.rerankTopK || 5
          })

          // 更新分数
          finalResults = rerankResults.map((res) => {
            const original = finalResults[res.index]
            return {
              ...original,
              finalScore: res.score
            }
          })
        } catch (e) {
          logWarn('Rerank failed, using original scores', 'HybridSearch', undefined, e as Error)
        }
      }

      // 7. 过滤低分结果
      if (this.config.minScore) {
        finalResults = finalResults.filter((r) => r.finalScore >= this.config.minScore)
      }

      context.hybridResults = finalResults
      context.processingTime = Date.now() - startTime

      return context
    } catch (error) {
      // 降级策略
      return this.fallbackToVectorSearch(query, options)
    }
  }

  // 优化关键词搜索
  private async performKeywordSearch(
    query: string,
    limit: number,
    options: HybridSearchOptions
  ): Promise<{ doc: Document; score: number }[]> {
    const table = await getVectorTable()
    if (!table) return []

    try {
      // 限制扫描范围
      const scanLimit = Math.min(2000, limit * 200)
      const queryBuilder = table.query().limit(scanLimit)
      
      let lancedbDocs = (await queryBuilder.toArray()) as LanceDBSearchResult[]

      // 应用过滤
      if (options.sources?.length || options.tags?.length) {
        const sourceSet = options.sources ? new Set(options.sources) : null
        const tagSet = options.tags ? new Set(options.tags) : null

        lancedbDocs = lancedbDocs.filter((d) => {
          const s = String(d.source || d.metadata?.source || '')
          const t = (d.tags || d.metadata?.tags || []) as string[]
          const sourceMatch = !sourceSet || sourceSet.has(s)
          const tagMatch = !tagSet || t.some((tag) => tagSet.has(tag))
          return sourceMatch && tagMatch
        })
      }

      if (lancedbDocs.length === 0) return []

      const bm25Searcher = await getBM25Searcher(lancedbDocs)
      const bm25Results = bm25Searcher.search(query, Math.min(limit, 50))

      return bm25Results.map((r) => ({
        doc: new Document({
          pageContent: r.result.text || r.result.pageContent || '',
          metadata: r.result.metadata || { source: r.result.source }
        }),
        score: r.score
      }))
    } catch (e) {
      logWarn('Keyword search failed', 'HybridSearch', { query }, e as Error)
      return []
    }
  }

  // 改进的降级策略
  private async fallbackToVectorSearch(
    query: string,
    options: HybridSearchOptions
  ): Promise<SearchContext> {
    logWarn('Using vector search fallback', 'HybridSearch', { query })
    
    const vectorResults = await searchSimilarDocumentsWithScores(query, {
      k: options.limit || this.config.topK || 10,
      sources: options.sources,
      tags: options.tags
    })

    return {
      query,
      hybridResults: vectorResults.map((r) => ({
        doc: r.doc,
        finalScore: r.score,
        sources: ['vector-fallback']
      })),
      processingTime: 0
    }
  }
}
```

### 4. 配置优化

#### 4.1 优化RAG配置
```typescript
// src/main/utils/config.ts - 优化版本
export const RAG_CONFIG = {
  // 检索配置 - 性能优化
  SEARCH: {
    DEFAULT_K: 8, // 从6增加到8，提高召回
    MAX_K: 25, // 从30降低，减少性能开销
    RELEVANCE_THRESHOLD: 0.15, // 从0.25降低，减少误杀
    RELEVANCE_THRESHOLD_LOW: 0.05,
    MIN_FETCH_K: 80,
    MAX_FETCH_K: 300, // 降低上限
    GLOBAL_SEARCH_MULTIPLIER: 30, // 从50降低
    FILTERED_SEARCH_MULTIPLIER: 15, // 从20降低
    GLOBAL_SEARCH_RATIO: 0.1, // 从0.15降低
    // MMR 多样性参数
    MMR_LAMBDA: 0.7, // 从0.75调整
    MMR_ENABLED: true,
    // 混合搜索权重 - 重新平衡
    HYBRID_SEARCH_ENABLED: true,
    BM25_WEIGHT: 0.5, // 从0.4调整为平衡
    VECTOR_WEIGHT: 0.5 // 从0.6调整为平衡
  },

  // 重排序配置 - 启用并优化
  RERANK: {
    ENABLED: true, // 改为true（如果有可用模型）
    MODEL: 'bge-reranker-base',
    TOP_K: 6, // 从5增加
    BATCH_SIZE: 16,
    SCORE_THRESHOLD: 0.1, // 从0.3降低，更宽松
    PROVIDER: 'local'
  },

  // 文档数量缓存 - 延长TTL
  DOC_COUNT_CACHE: {
    TTL: 120000 // 从60秒延长到120秒
  },

  // 批量处理 - 优化并发
  BATCH: {
    EMBEDDING_BATCH_SIZE: 64,
    DOCUMENT_BATCH_SIZE: 300, // 从500降低，减少内存压力
    MAX_CONCURRENT_FILES: 3,
    PROGRESS_UPDATE_INTERVAL: 20, // 从10增加，减少UI更新频率
    EMBEDDING_CONCURRENCY: 4 // 保持不变
  },

  // 输入验证
  VALIDATION: {
    MAX_QUERY_LENGTH: 2000,
    MIN_QUERY_LENGTH: 1,
    MAX_SOURCES: 100
  },

  // 日志配置
  LOG: {
    DEBUG_LOG_FLUSH_INTERVAL: 5000,
    MAX_DEBUG_LOG_BUFFER: 100
  },

  // 内存限制
  MEMORY: {
    MAX_RESULTS_IN_MEMORY: 500,
    WARNING_THRESHOLD_MB: 500
  },

  // 指标配置
  METRICS: {
    ENABLED: true,
    LOG_SLOW_QUERY_MS: 400, // 从600降低，更敏感
    LOG_SLOW_INDEX_MS: 1500, // 从2000降低
    LOG_TOP_K: 8
  },

  // LanceDB 配置 - 优化索引
  LANCEDB: {
    INDEX: {
      ENABLED: true,
      TYPE: 'HNSW',
      METRIC: 'cosine',
      EF_CONSTRUCTION: 128,
      M: 32,
      NUM_PARTITIONS: 128, // 从256降低
      NUM_SUB_VECTORS: 64
    },
    VACUUM_ON_REBUILD: true
  },

  // 跨语言检索 - 优化
  CROSS_LANGUAGE: {
    MAX_VARIANTS: 4,
    MERGE_LIMIT: 300, // 从500降低
    ENABLE_QUERY_EXPANSION: true,
    RRF_K: 50 // 从60微调
  },

  // 查询向量缓存 - 扩大并优化
  EMBEDDING: {
    QUERY_CACHE_SIZE: 512, // 从256扩大
    QUERY_CACHE_TTL: 600000, // 从300000延长到600000(10分钟)
    SIMILAR_QUERY_THRESHOLD: 0.92, // 从0.95降低，更宽松
    // 推荐模型保持不变
    RECOMMENDED_MULTILINGUAL_MODELS: [
      'multilingual-e5-small',
      'multilingual-e5-base',
      'bge-m3',
      'paraphrase-multilingual'
    ],
    DEFAULT_MODEL: 'multilingual-e5-small'
  },

  // 后端配置
  VECTOR_BACKEND: {
    TYPE: 'lancedb'
  },

  // 新增：性能调优参数
  PERFORMANCE: {
    MAX_CONCURRENT_QUERIES: 5, // 限制并发查询数
    ENABLE_EMBEDDING_BATCH: true, // 启用批量嵌入
    CACHE_WARMUP_ENABLED: true, // 启用预热
    LAZY_LOADING_ENABLED: true // 延迟加载大文档
  }
} as const
```

## 三、实施建议

### 1. 立即实施
- [x] 修复相关性过滤 - 已完成
- [ ] 扩大向量缓存 - 需要配置
- [ ] 调整阈值参数 - 需要配置

### 2. 短期优化 (1-2天)
- [ ] 限制全量扫描范围
- [ ] 优化混合搜索流程
- [ ] 启用重排序

### 3. 中期改进 (1周)
- [ ] 实现查询预热
- [ ] 添加缓存统计监控
- [ ] 优化LanceDB索引参数

### 4. 期期优化 (2-4周)
- [ ] 实现分布式检索
- [ ] 添加语义缓存层
- [ ] 实现智能查询路由

## 四、验证指标

### 性能指标
- 平均查询时间 < 500ms
- P99查询时间 < 2000ms
- 内存占用减少30%
- 并发支持 > 10 QPS

### 质量指标
- 召回率 > 85%
- 精确率 > 60%
- 跨语言召回率 > 70%
- 用户满意度 > 4.0/5.0

### 稳定性指标
- 错误率 < 1%
- 无内存泄漏
- 无重复请求
- 缓存命中率 > 40%

## 五、监控与调优

### 关键监控点
1. 执行时间分布
2. 缓存命中率
3. 结果数量分布
4. 跨语言查询比例
5. 降级触发频率

### 调优策略
1. 根据监控数据动态调整阈值
2. 基于用户反馈优化权重
3. 根据文档量调整扫描范围
4. 根据查询复杂度启用功能

这个优化方案应该能显著提升向量检索的性能和质量，同时保持系统的稳定性和可维护性。
