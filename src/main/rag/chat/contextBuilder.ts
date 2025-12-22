import { Document } from '@langchain/core/documents'
import { getSettings } from '../../settings'
import { RAG_CONFIG } from '../../utils/config'
import { logDebug, logWarn } from '../../utils/logger'
import {
  searchSimilarDocumentsWithScores,
  getDocCount,
  withEmbeddingProgressSuppressed
} from '../store/index'
import { ChatSource } from '../../../types/chat'
import { isUrlPath, ensureSourceDiversity, convertDocsToSources, deduplicateSources } from './utils'

export interface RagContextBuildResult {
  context: string
  sources: ChatSource[]
  isGlobalSearch: boolean
  emptyIndexMessage?: string
  metrics: {
    searchLimit: number
    retrievedCount: number
    effectiveCount: number
    uniqueSourceCount: number
    topScore?: number
    thresholdUsed?: number
    usedFallback: boolean
    durationMs: number
  }
}

export interface ChatOptions {
  sources?: string[]
  tags?: string[]
}

export async function buildRagContext(
  question: string,
  options: ChatOptions = {}
): Promise<RagContextBuildResult> {
  const startTime = Date.now()
  const settings = getSettings()
  const isGlobalSearch = !options.sources || options.sources.length === 0

  logDebug('Starting RAG context build', 'Chat', {
    question: question.slice(0, 50),
    sourcesCount: options.sources?.length ?? 0
  })

  const searchLimit = settings.rag?.searchLimit ?? RAG_CONFIG.SEARCH.DEFAULT_K

  let retrievedPairs: { doc: Document; score: number }[] = []
  try {
    const useHybrid =
      settings.rag?.useRerank ||
      settings.rag?.useMultiQuery ||
      /[a-zA-Z0-9]/.test(question) ||
      question.includes(' ') ||
      question.length >= 20

    logDebug('Context build strategy', 'Chat', {
      useHybrid,
      reason: {
        useRerank: settings.rag?.useRerank,
        useMultiQuery: settings.rag?.useMultiQuery,
        regexMatch: /[a-zA-Z0-9]/.test(question),
        hasSpace: question.includes(' '),
        length: question.length
      }
    })

    // 判断是否应该使用混合搜索
    // 混合搜索适用于：全库检索 或 有跨语言需求 或 多查询需求
    const shouldUseHybrid = useHybrid && isGlobalSearch

    logDebug('Search strategy decision', 'Chat', {
      useHybrid,
      isGlobalSearch,
      shouldUseHybrid,
      questionLength: question.length,
      hasEnglish: /[a-zA-Z0-9]/.test(question)
    })

    if (shouldUseHybrid) {
      const { HybridSearcher } = await import('../hybridSearch')
      const searcher = new HybridSearcher({ topK: searchLimit })

      logDebug('Executing hybrid search', 'Chat', {
        question: question.slice(0, 60),
        isGlobalSearch,
        searchLimit,
        useMultiQuery: settings.rag?.useMultiQuery ?? false
      })

      const ctx = await searcher.search(question, {
        sources: options.sources,
        tags: options.tags,
        limit: searchLimit,
        useMultiQuery: settings.rag?.useMultiQuery ?? false
      })

      const hybrid = ctx.hybridResults ?? []
      retrievedPairs = hybrid.map((r) => ({ doc: r.doc, score: r.finalScore }))

      logDebug('Hybrid search results', 'Chat', {
        retrievedCount: retrievedPairs.length,
        hasResults: retrievedPairs.length > 0
      })

      if (retrievedPairs.length === 0) {
        logDebug('Hybrid search returned empty, fallback to vector search', 'Chat', {
          searchLimit
        })
        retrievedPairs = await withEmbeddingProgressSuppressed(() =>
          searchSimilarDocumentsWithScores(question, {
            k: searchLimit,
            sources: options.sources,
            tags: options.tags
          })
        )
      }
    } else {
      logDebug('Using standard vector search', 'Chat', {
        isGlobalSearch,
        searchLimit,
        useHybrid,
        reason: !isGlobalSearch ? 'specific sources selected' : 'hybrid search disabled'
      })
      retrievedPairs = await withEmbeddingProgressSuppressed(() =>
        searchSimilarDocumentsWithScores(question, {
          k: searchLimit,
          sources: options.sources,
          tags: options.tags
        })
      )
    }
  } catch (e) {
    logWarn('Hybrid search failed, fallback to vector search', 'Chat', undefined, e as Error)
    retrievedPairs = await withEmbeddingProgressSuppressed(() =>
      searchSimilarDocumentsWithScores(question, {
        k: searchLimit,
        sources: options.sources,
        tags: options.tags
      })
    )
  }

  logDebug('Retrieved documents', 'Chat', {
    count: retrievedPairs.length,
    topScore: retrievedPairs[0]?.score.toFixed(3)
  })

  const uniqueSourcCount = new Set(retrievedPairs.map((p) => p.doc.metadata?.source)).size
  logDebug('Source diversity', 'Chat', { uniqueSources: uniqueSourcCount })

  if (retrievedPairs.length === 0) {
    const docCount = await getDocCount()
    if (docCount === 0) {
      const msg =
        '知识库索引为空或已丢失。如果您刚刚切换了嵌入模型，请等待后台索引重建完成；否则请在侧边栏中点击"重建索引"。'
      return {
        context: '',
        sources: [],
        isGlobalSearch,
        emptyIndexMessage: msg,
        metrics: {
          searchLimit,
          retrievedCount: 0,
          effectiveCount: 0,
          uniqueSourceCount: 0,
          usedFallback: false,
          durationMs: Date.now() - startTime
        }
      }
    }
  }

  const RELEVANCE_THRESHOLD = settings.rag?.minRelevance ?? RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD
  const RELEVANCE_THRESHOLD_LOW = Math.max(0.1, RELEVANCE_THRESHOLD - 0.15)
  let effectivePairs = retrievedPairs
  let effectiveThreshold: number | undefined

  if (retrievedPairs.length > 0) {
    const topScore = retrievedPairs[0]?.score ?? 0
    const topSource = retrievedPairs[0]?.doc.metadata?.source || ''
    const queryKeywords = question.match(/[\u4e00-\u9fa5]{2,4}/g) || []
    const fileNameMatchesQuery = queryKeywords.some((kw) =>
      topSource.toLowerCase().includes(kw.toLowerCase())
    )

    if (fileNameMatchesQuery) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW
    } else if (topScore >= RELEVANCE_THRESHOLD) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW
    } else if (topScore >= RELEVANCE_THRESHOLD_LOW) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW
    } else {
      effectiveThreshold = 0
    }

    effectivePairs = retrievedPairs.filter((p) => {
      if (p.score >= (effectiveThreshold || 0)) return true
      const source = p.doc.metadata?.source || ''
      return queryKeywords.some((kw) => source.toLowerCase().includes(kw.toLowerCase()))
    })

    logDebug('Filtered by relevance threshold', 'Chat', {
      before: retrievedPairs.length,
      after: effectivePairs.length,
      threshold: effectiveThreshold,
      topScore: topScore.toFixed(3),
      fileNameMatch: fileNameMatchesQuery
    })
  }

  let usedFallback = false
  if (effectivePairs.length === 0 && options.sources && options.sources.length > 0) {
    usedFallback = true
    effectivePairs = await loadFallbackContext(options.sources)
  }

  const diversePairs = ensureSourceDiversity(effectivePairs)
  const effectiveDocs = diversePairs.map((p) => p.doc)
  const effectiveScores = diversePairs.map((p) => p.score)
  const context = effectiveDocs.map((doc) => doc.pageContent).join('\n\n')

  const sources = convertDocsToSources(effectiveDocs, effectiveScores)
  const uniqueSources = deduplicateSources(sources)

  logDebug('Final sources', 'Chat', {
    sourceCount: uniqueSources.length,
    fileNames: uniqueSources.map((s) => s.fileName).join(', ')
  })

  logDebug('Context built', 'Chat', { docCount: effectiveDocs.length })

  return {
    context,
    sources: uniqueSources,
    isGlobalSearch,
    metrics: {
      searchLimit,
      retrievedCount: retrievedPairs.length,
      effectiveCount: effectiveDocs.length,
      uniqueSourceCount: uniqueSources.length,
      topScore: retrievedPairs[0]?.score,
      thresholdUsed: effectiveThreshold,
      usedFallback,
      durationMs: Date.now() - startTime
    }
  }
}

/** 加载兜底上下文（当检索失败时） */
async function loadFallbackContext(sources: string[]): Promise<{ doc: Document; score: number }[]> {
  try {
    const fallbackDocs: Document[] = []

    for (const s of sources) {
      if (isUrlPath(s)) {
        const { loadFromUrl } = await import('../urlLoader')
        const res = await loadFromUrl(s)
        if (res.success && res.documents) {
          fallbackDocs.push(...res.documents.slice(0, 2))
        }
      } else {
        const { loadAndSplitFileInWorker } = await import('../workerManager')
        const docs = await loadAndSplitFileInWorker(s)
        fallbackDocs.push(...docs.slice(0, 2))
      }
    }

    // 兜底文档使用较低的分数
    return fallbackDocs.slice(0, 4).map((doc, i) => ({
      doc,
      score: 0.3 - i * 0.05
    }))
  } catch (e) {
    logWarn('Fallback context load failed', 'Chat', undefined, e as Error)
    return []
  }
}
