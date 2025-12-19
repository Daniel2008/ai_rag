/**
 * BM25 关键词搜索算法
 * 与向量搜索结合，提高全库检索命中率
 */

import type { LanceDBSearchResult } from './types'
import { logDebug } from '../../utils/logger'

/**
 * 简单分词器（支持中英文）
 */
function tokenize(text: string): string[] {
  const normalized = text.toLowerCase()

  // 提取英文单词（包括连字符词）
  const englishWords = normalized.match(/[a-z][a-z0-9-]{0,}/g) || []

  // 提取中文字符（每2-4字作为一个token）
  const chineseChars = normalized.match(/[\u4e00-\u9fa5]+/g) || []
  const chineseTokens: string[] = []
  for (const segment of chineseChars) {
    // 单字也加入（用于匹配）
    for (let i = 0; i < segment.length; i++) {
      chineseTokens.push(segment[i])
    }
    // 2-gram 和 3-gram
    for (let i = 0; i < segment.length - 1; i++) {
      chineseTokens.push(segment.slice(i, i + 2))
      if (i < segment.length - 2) {
        chineseTokens.push(segment.slice(i, i + 3))
      }
      if (i < segment.length - 3) {
        chineseTokens.push(segment.slice(i, i + 4))
      }
    }
    // 整个词也加入
    if (segment.length >= 2) {
      chineseTokens.push(segment)
    }
  }

  // 提取数字
  const numbers = normalized.match(/\d+/g) || []

  return [...englishWords, ...chineseTokens, ...numbers]
}

/**
 * 停用词集合
 */
const STOP_WORDS = new Set([
  // 英文停用词
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'in',
  'on',
  'at',
  'to',
  'for',
  'of',
  'with',
  'by',
  'from',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'have',
  'has',
  'had',
  'do',
  'does',
  'did',
  'will',
  'would',
  'could',
  'should',
  'may',
  'might',
  'must',
  'this',
  'that',
  'these',
  'those',
  'it',
  'its',
  'as',
  'if',
  'then',
  'than',
  'so',
  // 中文停用词
  '的',
  '了',
  '和',
  '是',
  '在',
  '有',
  '与',
  '为',
  '对',
  '等',
  '及',
  '或',
  '也',
  '不',
  '就',
  '都',
  '而',
  '及',
  '着',
  '把',
  '被',
  '让',
  '给',
  '向',
  '从',
  '到',
  '以',
  '于'
])

/**
 * 过滤停用词
 */
function removeStopWords(tokens: string[]): string[] {
  return tokens.filter((t) => t.length > 1 && !STOP_WORDS.has(t))
}

/**
 * BM25 参数
 */
const BM25_K1 = 1.5 // 词频饱和参数
const BM25_B = 0.75 // 文档长度归一化参数

/**
 * BM25 搜索器
 */
export class BM25Searcher {
  private documents: LanceDBSearchResult[] = []
  private tokenizedDocs: string[][] = []
  private docLengths: number[] = []
  private avgDocLength: number = 0
  private idf: Map<string, number> = new Map()
  private termFreqs: Map<string, Map<number, number>> = new Map() // term -> docIdx -> freq

  /**
   * 构建索引
   */
  buildIndex(documents: LanceDBSearchResult[]): void {
    this.documents = documents
    this.tokenizedDocs = []
    this.docLengths = []
    this.idf = new Map()
    this.termFreqs = new Map()

    const docFreq = new Map<string, number>() // 每个词出现在多少文档中

    // 分词并统计
    for (let i = 0; i < documents.length; i++) {
      const doc = documents[i]
      const text =
        (doc.text || doc.pageContent || '') + ' ' + (doc.source || doc.metadata?.source || '')
      const tokens = removeStopWords(tokenize(text))
      this.tokenizedDocs.push(tokens)
      this.docLengths.push(tokens.length)

      // 统计词频
      const termSet = new Set<string>()
      for (const token of tokens) {
        termSet.add(token)

        if (!this.termFreqs.has(token)) {
          this.termFreqs.set(token, new Map())
        }
        const freqMap = this.termFreqs.get(token)!
        freqMap.set(i, (freqMap.get(i) || 0) + 1)
      }

      // 更新文档频率
      for (const term of termSet) {
        docFreq.set(term, (docFreq.get(term) || 0) + 1)
      }
    }

    // 计算平均文档长度
    const totalLength = this.docLengths.reduce((a, b) => a + b, 0)
    this.avgDocLength = totalLength / Math.max(documents.length, 1)

    // 计算 IDF
    const N = documents.length
    for (const [term, df] of docFreq.entries()) {
      // IDF = log((N - df + 0.5) / (df + 0.5) + 1)
      const idfValue = Math.log((N - df + 0.5) / (df + 0.5) + 1)
      this.idf.set(term, idfValue)
    }

    logDebug('BM25 index built', 'BM25', {
      docCount: documents.length,
      avgDocLength: this.avgDocLength.toFixed(2),
      uniqueTerms: this.idf.size
    })
  }

  /**
   * 搜索
   */
  search(query: string, topK: number): { result: LanceDBSearchResult; score: number }[] {
    if (this.documents.length === 0) {
      return []
    }

    const queryTokens = removeStopWords(tokenize(query))
    if (queryTokens.length === 0) {
      return []
    }

    const scores: { idx: number; score: number }[] = []

    for (let docIdx = 0; docIdx < this.documents.length; docIdx++) {
      let score = 0
      const docLength = this.docLengths[docIdx]
      const docTokens = this.tokenizedDocs[docIdx]

      for (const term of queryTokens) {
        const idf = this.idf.get(term) || 0
        const freqMap = this.termFreqs.get(term)
        let tf = freqMap?.get(docIdx) || 0

        // 如果精确匹配没找到，尝试部分匹配
        if (tf === 0 && term.length >= 2) {
          // 检查文档中是否有包含此 term 的 token
          for (const docToken of docTokens) {
            if (docToken.includes(term) || term.includes(docToken)) {
              tf = 1
              break
            }
          }
        }

        if (tf > 0) {
          // BM25 公式
          const numerator = tf * (BM25_K1 + 1)
          const denominator = tf + BM25_K1 * (1 - BM25_B + BM25_B * (docLength / this.avgDocLength))
          // 对于部分匹配，使用默认 IDF
          const effectiveIdf = idf > 0 ? idf : Math.log(this.documents.length + 1)
          score += effectiveIdf * (numerator / denominator)
        }
      }

      if (score > 0) {
        scores.push({ idx: docIdx, score })
      }
    }

    // 按分数降序排序
    scores.sort((a, b) => b.score - a.score)

    // 返回 top-K
    return scores.slice(0, topK).map(({ idx, score }) => ({
      result: this.documents[idx],
      score
    }))
  }

  /**
   * 批量搜索多个查询变体并合并
   */
  searchMultiple(
    queries: string[],
    topK: number
  ): { result: LanceDBSearchResult; score: number }[] {
    const allResults = new Map<string, { result: LanceDBSearchResult; score: number }>()

    for (const query of queries) {
      const results = this.search(query, topK)
      for (const { result, score } of results) {
        const key =
          result.text || result.pageContent || JSON.stringify(result.metadata?.source || '')
        const existing = allResults.get(key)
        if (existing) {
          // 取最高分
          if (score > existing.score) {
            allResults.set(key, { result, score })
          }
        } else {
          allResults.set(key, { result, score })
        }
      }
    }

    // 排序并返回
    return Array.from(allResults.values())
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
  }
}

/**
 * 全局 BM25 搜索器实例
 */
let bm25Searcher: BM25Searcher | null = null
let bm25DocCount = 0

/**
 * 获取或创建 BM25 搜索器
 */
export async function getBM25Searcher(
  documents: LanceDBSearchResult[],
  forceRebuild: boolean = false
): Promise<BM25Searcher> {
  if (!bm25Searcher || forceRebuild || documents.length !== bm25DocCount) {
    bm25Searcher = new BM25Searcher()
    bm25Searcher.buildIndex(documents)
    bm25DocCount = documents.length
  }
  return bm25Searcher
}

/**
 * 清除 BM25 索引缓存
 */
export function clearBM25Cache(): void {
  bm25Searcher = null
  bm25DocCount = 0
}
