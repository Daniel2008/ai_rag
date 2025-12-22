import type { Embeddings } from '@langchain/core/embeddings'
import { Document } from '@langchain/core/documents'
import type { Table } from '@lancedb/lancedb'
import { logDebug, logWarn, logError } from '../../utils/logger'
import { RAG_CONFIG } from '../../utils/config'
import type {
  SearchOptions,
  LanceDBSearchResult,
  LanceDBSearchQuery,
  DocumentWithDistance,
  ScoredDocument
} from './types'
import { reciprocalRankFusion, mmrRerankByContent } from './algorithms'
import {
  calculateFetchK,
  normalizePath,
  estimateQueryComplexity,
  classifyQueryIntent,
  buildWhereClause,
  filterResultsBySource,
  distanceToScore,
  diversifyBySource
} from './utils'
import { vectorStore, table, initVectorStore } from './core'
import { getEmbeddings } from './embeddings'
import { getSettings } from '../../settings'
import { getBM25Searcher } from './bm25'
import { searchByFileName, extractFileNameKeywords, filterByRelevanceThreshold } from './search'

export async function performNativeSearch(
  tableRef: Table,
  vector: number[],
  searchLimit: number,
  whereClause?: string
): Promise<LanceDBSearchResult[]> {
  let searchQuery = tableRef.search(vector) as unknown as LanceDBSearchQuery

  if (whereClause) {
    try {
      if (searchQuery.where && typeof searchQuery.where === 'function') {
        searchQuery = searchQuery.where(whereClause)
      }
    } catch (whereError) {
      logWarn('Where clause not supported', 'Search', undefined, whereError as Error)
    }
  }

  const refineFactor = searchLimit > 200 ? 2 : 1
  try {
    if (searchQuery.refineFactor && typeof searchQuery.refineFactor === 'function') {
      searchQuery = searchQuery.refineFactor(refineFactor)
    }
  } catch (refineError) {
    logWarn('Refine factor not supported', 'Search', undefined, refineError as Error)
  }

  return await searchQuery.limit(searchLimit).toArray()
}

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
    
    // 2. 为每个变体生成向量并搜索
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

    // 3. RRF融合
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
      _rrfScore: score
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
    logWarn(
      'Cross-language search failed, using original query',
      'Search',
      undefined,
      error as Error
    )
    const queryVector = await getQueryVector(query, embeddings)
    return await performNativeSearch(tableRef, queryVector, fetchK, whereClause)
  }
}

export function convertToScoredDocuments(
  searchResults: LanceDBSearchResult[]
): DocumentWithDistance[] {
  return searchResults
    .map((row) => {
      const distance = row._distance ?? 0
      const doc = new Document({
        pageContent: row.text || row.pageContent || '',
        metadata: {
          source: row.source || row.metadata?.source,
          pageNumber: row.pageNumber || row.metadata?.pageNumber,
          ...row.metadata
        }
      })
      return { doc, distance }
    })
    .sort((a, b) => a.distance - b.distance)
}

export async function fallbackToLangChainSearch(
  query: string,
  k: number,
  getDocCountCached: () => Promise<number>,
  sources?: string[]
): Promise<ScoredDocument[]> {
  if (!vectorStore) return []

  logDebug('Falling back to LangChain similaritySearch', 'Search')

  try {
    const isGlobalSearch = !sources || sources.length === 0
    const docCount = await getDocCountCached()
    const fetchK = calculateFetchK(k, docCount, isGlobalSearch)

    const docs = await vectorStore.similaritySearch(query, fetchK)

    let filteredDocs = docs
    if (sources && sources.length > 0) {
      filteredDocs = docs.filter((doc) => {
        const docSource = doc.metadata?.source ? normalizePath(String(doc.metadata.source)) : ''
        const sourceSet = new Set(sources.map((s) => normalizePath(s)))
        if (sourceSet.has(docSource)) return true
        if (sourceSet.size < 50) {
          for (const s of sourceSet) {
            if (docSource.endsWith(s) || s.endsWith(docSource)) return true
          }
        }
        return false
      })
    }

    return filteredDocs.slice(0, k).map((doc, i) => ({
      doc,
      score: 1 - i / Math.max(filteredDocs.length, 1)
    }))
  } catch (fallbackError) {
    logError('Fallback search also failed', 'Search', undefined, fallbackError as Error)
    return []
  }
}

export async function searchSimilarDocumentsWithScores(
  query: string,
  options: SearchOptions,
  getDocCountCached: () => Promise<number>,
  getQueryVector: (query: string, embeddings: Embeddings) => Promise<number[]>
): Promise<ScoredDocument[]> {
  const searchStart = Date.now()
  const { k = 4, sources } = options
  const metrics: Record<string, number | string> = {}

  logDebug('Starting search', 'Search', {
    query: query.slice(0, 50),
    sourcesCount: sources?.length ?? 0
  })

  await initVectorStore()

  if (!vectorStore || !table) {
    logWarn('vectorStore or table is null, returning empty', 'Search')
    return []
  }

  const docCount = await getDocCountCached()
  const isGlobalSearch = !sources || sources.length === 0
  const complexity = estimateQueryComplexity(query)
  const intent = classifyQueryIntent(query)

  const settings = getSettings()
  const maxSearchLimit = settings.rag?.maxSearchLimit ?? RAG_CONFIG.SEARCH.MAX_K
  const defaultSearchLimit = settings.rag?.searchLimit ?? RAG_CONFIG.SEARCH.DEFAULT_K

  let baseK = k
  if (intent === 'definition') baseK = Math.max(3, Math.round(k * 0.8))
  if (intent === 'summary') baseK = Math.round(k * 1.5)
  if (intent === 'comparison') baseK = Math.round(k * 1.6)

  const adaptiveK = Math.min(
    maxSearchLimit,
    Math.max(baseK, Math.round(baseK + complexity * defaultSearchLimit))
  )
  const fetchK = Math.round(
    calculateFetchK(adaptiveK, docCount, isGlobalSearch) * (1 + complexity * 0.5)
  )

  metrics.fetchK = fetchK
  metrics.docCount = docCount
  metrics.complexity = Number(complexity.toFixed(2))
  metrics.intent = intent

  try {
    const whereClause = buildWhereClause(sources, options.tags)

    let allDocsForBM25: LanceDBSearchResult[] = []
    if (isGlobalSearch) {
      try {
        allDocsForBM25 = (await table.query().limit(5000).toArray()) as LanceDBSearchResult[]
      } catch (e) {
        logWarn('Failed to load docs for BM25', 'Search', undefined, e as Error)
      }
    }

    let bm25Results: LanceDBSearchResult[] = []
    const bm25Start = Date.now()
    if (isGlobalSearch && allDocsForBM25.length > 0) {
      try {
        const bm25Searcher = await getBM25Searcher(allDocsForBM25)
        const keywords = extractFileNameKeywords(query)
        const queryVariants = [query, ...keywords.slice(0, 3)]

        const bm25SearchResults = bm25Searcher.searchMultiple(queryVariants, fetchK)
        bm25Results = bm25SearchResults.map(({ result, score }) => ({
          ...result,
          _distance: 1 / (score + 1),
          _bm25Score: score
        }))
      } catch (e) {
        logWarn('BM25 search failed', 'Search', undefined, e as Error)
      }
    }
    metrics.bm25SearchMs = Date.now() - bm25Start

    let fileNameMatches: LanceDBSearchResult[] = []
    if (isGlobalSearch) {
      const fnStart = Date.now()
      const fnResult = await searchByFileName(table, query, fetchK)
      fileNameMatches = fnResult.results
      metrics.fileNameSearchMs = Date.now() - fnStart
    }

    const vectorSearchStart = Date.now()
    const embeddings = getEmbeddings()
    const searchResults = await performCrossLanguageSearch(
      table,
      query,
      embeddings,
      fetchK,
      getQueryVector,
      whereClause
    )
    metrics.vectorSearchMs = Date.now() - vectorSearchStart

    const getResultKey = (r: LanceDBSearchResult): string => {
      const content = r.text || r.pageContent || ''
      const source = r.source || r.metadata?.source || ''
      return `${source}::${content}`
    }

    const resultLists: LanceDBSearchResult[][] = []
    if (searchResults.length > 0) resultLists.push(searchResults)
    if (bm25Results.length > 0) resultLists.push(bm25Results)
    if (fileNameMatches.length > 0) {
      resultLists.push(fileNameMatches)
      resultLists.push(fileNameMatches)
    }

    let mergedResults: LanceDBSearchResult[] = []
    if (resultLists.length > 1) {
      const rrfResults = reciprocalRankFusion(
        resultLists,
        getResultKey,
        RAG_CONFIG.CROSS_LANGUAGE.RRF_K
      )
      const maxRrfScore = rrfResults.length > 0 ? rrfResults[0].score : 1
      const minRrfScore = rrfResults.length > 0 ? rrfResults[rrfResults.length - 1].score : 0
      const scoreRange = maxRrfScore - minRrfScore || 1

      mergedResults = rrfResults.slice(0, fetchK).map(({ item, score }) => {
        const normalizedScore = (score - minRrfScore) / scoreRange
        const distance = (1 - normalizedScore) * 0.8
        return { ...item, _distance: distance, _rrfScore: score }
      })
    } else if (resultLists.length === 1) {
      mergedResults = resultLists[0]
    }

    if (mergedResults.length === 0) return []

    let scoredDocs = convertToScoredDocuments(mergedResults)

    if (sources && sources.length > 0) {
      scoredDocs = filterResultsBySource(scoredDocs, sources)
    }

    if (scoredDocs.length === 0) return []

    let finalResultsRaw = scoredDocs.map((r) => ({
      doc: r.doc,
      score: distanceToScore(r.distance)
    }))

    const minRelevance = settings.rag?.minRelevance ?? RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD
    finalResultsRaw = filterByRelevanceThreshold(finalResultsRaw, query, minRelevance)

    if (finalResultsRaw.length === 0) return []

    let finalResults = finalResultsRaw

    const mmrEnabled = RAG_CONFIG.SEARCH.MMR_ENABLED
    const mmrLambda = RAG_CONFIG.SEARCH.MMR_LAMBDA

    if (mmrEnabled && finalResultsRaw.length > adaptiveK) {
      const lambda = intent === 'summary' || intent === 'comparison' ? mmrLambda - 0.1 : mmrLambda
      finalResults = mmrRerankByContent(finalResultsRaw, adaptiveK, lambda)
    } else if (intent === 'summary' || intent === 'comparison') {
      finalResults = diversifyBySource(finalResultsRaw, adaptiveK)
    }

    const elapsed = Date.now() - searchStart
    metrics.totalMs = elapsed

    logDebug('Search completed', 'Search', {
      resultCount: Math.min(finalResults.length, k),
      latencyMs: elapsed,
      query: query.slice(0, 50)
    })

    return finalResults.slice(0, k)
  } catch (e) {
    logError('Native search failed', 'Search', undefined, e as Error)
    return await fallbackToLangChainSearch(query, k, getDocCountCached, sources)
  }
}

export async function searchSimilarDocuments(
  query: string,
  options: SearchOptions,
  getDocCountCached: () => Promise<number>,
  getQueryVector: (query: string, embeddings: Embeddings) => Promise<number[]>
): Promise<Document[]> {
  const results = await searchSimilarDocumentsWithScores(
    query,
    options,
    getDocCountCached,
    getQueryVector
  )
  return results.map((r) => r.doc)
}
