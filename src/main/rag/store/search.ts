/**
 * 搜索相关逻辑
 * - 关键词提取
 * - 相关性验证
 * - 文件名搜索
 */

import type { Document } from '@langchain/core/documents'
import type { Table } from '@lancedb/lancedb'
import type { LanceDBSearchResult, RelevanceCheckResult, FileNameSearchResult } from './types'
import { RAG_CONFIG } from '../../utils/config'
import { logDebug } from '../../utils/logger'

/**
 * 多语言术语映射表（扩展版）
 * 用于跨语言关键词匹配
 */
const TERM_MAPPINGS: Record<string, string[]> = {
  // AI / 人工智能相关
  人工智能: ['AI', 'artificial', 'intelligence', 'アイ', '인공지능', 'state-of-ai', 'state of ai'],
  机器学习: ['ML', 'machine', 'learning', '機械学習', '머신러닝'],
  深度学习: ['DL', 'deep', 'learning', 'ディープラーニング', '딥러닝', 'neural'],
  大模型: ['LLM', 'GPT', 'model', 'large', 'language', 'foundation'],
  大语言模型: ['LLM', 'large', 'language', 'model', 'GPT', 'Claude', 'Llama', 'Gemini', 'ChatGPT'],
  自然语言: ['NLP', 'natural', 'language', 'processing', 'NLU', 'NLG'],
  神经网络: ['neural', 'network', 'NN', 'ニューラルネットワーク', 'CNN', 'RNN', 'transformer'],
  计算机视觉: ['CV', 'computer', 'vision', 'image', 'recognition', 'detection'],
  强化学习: ['RL', 'reinforcement', 'learning', 'reward', 'agent'],
  生成式: ['generative', 'GenAI', 'generation', 'AIGC', 'diffusion'],
  向量: ['vector', 'embedding', 'ベクトル', 'embeddings'],
  检索: ['retrieval', 'search', 'RAG', 'retrieval-augmented'],
  推理: ['inference', 'reasoning', 'CoT', 'chain-of-thought'],
  微调: ['fine-tune', 'finetuning', 'RLHF', 'SFT', 'lora', 'adapter'],
  预训练: ['pretrain', 'pretraining', 'foundation', 'base model'],
  多模态: ['multimodal', 'vision-language', 'VLM', 'image-text'],
  智能体: ['agent', 'autonomous', 'agentic', 'multi-agent'],
  提示词: ['prompt', 'prompting', 'instruction', 'few-shot'],

  // 技术相关
  数据库: ['database', 'DB', 'SQL', 'データベース', 'NoSQL', 'vector database'],
  云计算: ['cloud', 'computing', 'AWS', 'Azure', 'GCP', 'serverless'],
  区块链: ['blockchain', 'crypto', 'ブロックチェーン', 'web3', 'ethereum'],
  网络安全: ['cybersecurity', 'security', 'サイバーセキュリティ', 'infosec'],
  容器: ['container', 'docker', 'kubernetes', 'k8s'],
  微服务: ['microservice', 'service', 'API', 'REST'],

  // 商业/文档相关
  市场分析: ['market', 'analysis', 'マーケット分析', 'research'],
  财务报告: ['financial', 'report', 'finance', '財務報告', 'annual report'],
  战略: ['strategy', 'strategic', '戦略', 'planning'],
  现状: ['status', 'state', 'current', 'overview', 'landscape'],
  分析: ['analysis', 'analyze', 'analytics', 'insight'],
  报告: ['report', 'paper', 'whitepaper', 'document'],
  研究: ['research', 'study', 'investigation', 'survey'],
  趋势: ['trend', 'forecast', 'prediction', 'outlook'],

  // 英文到中文反向映射
  AI: ['人工智能', '智能', 'artificial intelligence'],
  'machine learning': ['机器学习', 'ML'],
  'deep learning': ['深度学习', 'DL', 'neural network'],
  'state of ai': ['人工智能现状', 'AI发展', 'AI现状', 'state-of-ai'],
  GPT: ['大模型', 'LLM', '大语言模型', 'ChatGPT'],
  LLM: ['大语言模型', '大模型', 'language model'],
  NLP: ['自然语言处理', '自然语言', 'natural language'],
  'computer vision': ['计算机视觉', 'CV', '图像识别'],
  'neural network': ['神经网络', 'NN', '深度学习'],
  RAG: ['检索增强', '检索', 'retrieval'],
  embedding: ['向量', '嵌入', 'vector']
}

/**
 * 通用停用词集合
 */
const COMMON_WORDS = new Set([
  // 中文
  '介绍',
  '内容',
  '什么',
  '哪些',
  '怎样',
  '如何',
  '为什么',
  '关于',
  '请问',
  '告诉',
  '说说',
  '讲讲',
  '现状',
  '分析',
  '研究',
  '报告',
  '文档',
  '资料',
  // 英文
  'the',
  'of',
  'and',
  'to',
  'in',
  'is',
  'a',
  'an',
  'for',
  'on',
  'with',
  'about',
  'this',
  'that',
  'these',
  'those',
  'some',
  'any',
  'all',
  'introduction',
  'overview',
  'summary',
  'document',
  'report',
  'analysis',
  // 日文
  'について',
  'とは',
  'です',
  'ます'
])

/**
 * 从查询中提取文件名关键词（多语言支持）
 */
export function extractFileNameKeywords(query: string): string[] {
  // 移除常见的疑问词和语气词
  const cleanQuery = query
    .replace(/[是什么谁干啥做的吗呢吧呀哪里怎么样如何为什么？?！!。，,的了和与]/g, ' ')
    .replace(
      /\b(what|who|how|why|when|where|which|is|are|was|were|the|a|an|of|to|in|for|on|with)\b/gi,
      ' '
    )
    .trim()

  // 提取中文词组（2-8字）
  const chineseKeywords = cleanQuery.match(/[\u4e00-\u9fa5]{2,8}/g) || []

  // 提取日文假名词组
  const japaneseKeywords = cleanQuery.match(/[\u3040-\u30ff\u4e00-\u9fa5]{2,10}/g) || []

  // 提取韩文词组
  const koreanKeywords = cleanQuery.match(/[\uac00-\ud7af]{2,10}/g) || []

  // 提取英文关键词
  const englishKeywords = cleanQuery.match(/[a-zA-Z][a-zA-Z0-9_-]{1,24}/gi) || []

  // 添加映射的关键词
  const mappedKeywords: string[] = []
  const queryLower = cleanQuery.toLowerCase()

  for (const [term, aliases] of Object.entries(TERM_MAPPINGS)) {
    if (cleanQuery.includes(term)) {
      mappedKeywords.push(...aliases)
    }
    for (const alias of aliases) {
      if (queryLower.includes(alias.toLowerCase())) {
        mappedKeywords.push(term)
        mappedKeywords.push(...aliases.filter((a) => a !== alias))
      }
    }
  }

  const allKeywords = [
    ...chineseKeywords,
    ...japaneseKeywords,
    ...koreanKeywords,
    ...englishKeywords,
    ...mappedKeywords
  ]

  const filtered = allKeywords.filter(
    (kw) => !COMMON_WORDS.has(kw.toLowerCase()) && kw.length >= 2 && !/^\d+$/.test(kw)
  )

  const unique = [...new Set(filtered)]

  logDebug('Extracted keywords', 'Search', {
    query: query.slice(0, 50),
    keywords: unique.slice(0, 10),
    totalCount: unique.length
  })

  return unique
}

/**
 * 检查文档是否与查询相关
 */
export function isDocumentRelevantToQuery(docContent: string, query: string): RelevanceCheckResult {
  const queryLower = query.toLowerCase()
  const docLower = docContent.toLowerCase()

  const queryKeywords = extractFileNameKeywords(query)
  if (queryKeywords.length === 0) {
    return { relevant: true, matchScore: 0.5, matchedTerms: [] }
  }

  let matchCount = 0
  const matchedTerms: string[] = []

  for (const kw of queryKeywords) {
    const kwLower = kw.toLowerCase()
    if (docLower.includes(kwLower)) {
      matchCount++
      matchedTerms.push(kw)
    }
  }

  const matchScore = matchCount / queryKeywords.length
  const hasDirectMatch = matchedTerms.length > 0

  const queryWords = queryLower
    .split(/[\s\u3000]+/)
    .filter((word) => word.length > 1 && !/^[\u4e00-\u9fa5]$/.test(word))

  const hasQuerySubstring = queryWords.some((word) => word.length > 2 && docLower.includes(word))

  const relevant = hasDirectMatch || hasQuerySubstring || matchScore >= 0.25

  if (!relevant && queryKeywords.length > 0) {
    logDebug('Document relevance check failed', 'Search', {
      queryKeywords: queryKeywords.slice(0, 5),
      matchedTerms,
      matchScore: matchScore.toFixed(2),
      docPreview: docContent.slice(0, 100)
    })
  }

  return { relevant, matchScore, matchedTerms }
}

/**
 * 根据相关性阈值过滤结果
 * 优化：更宽松的过滤逻辑，避免误杀相关结果
 */
export function filterByRelevanceThreshold<T extends { score: number; doc: Document }>(
  results: T[],
  _query: string, // 保留query参数用于日志和调试
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

  logDebug('Relevance threshold filter', 'Search', {
    before: results.length,
    after: scoreFiltered.length,
    threshold,
    topScores: results.slice(0, 5).map((r) => r.score.toFixed(3))
  })

  return scoreFiltered
}

/**
 * 搜索文件名匹配的文档
 */
export async function searchByFileName(
  tableRef: Table,
  query: string,
  limit: number
): Promise<FileNameSearchResult> {
  const keywords = extractFileNameKeywords(query)
  if (keywords.length === 0) return { results: [], matchedKeywords: [] }

  logDebug('Searching by filename keywords', 'Search', { keywords })

  try {
    const allRows = (await tableRef.query().limit(2000).toArray()) as LanceDBSearchResult[]

    const exactMatches: LanceDBSearchResult[] = []
    const contentMatches: LanceDBSearchResult[] = []
    const partialMatches: LanceDBSearchResult[] = []
    const matchedKeywords: string[] = []

    for (const row of allRows) {
      const source = (row.source || row.metadata?.source || '').toLowerCase()
      const text = (row.text || row.pageContent || '').toLowerCase()
      const fileName = source.split(/[\\/]/).pop() || ''

      let fileNameMatchCount = 0
      let contentMatchCount = 0

      for (const kw of keywords) {
        const kwLower = kw.toLowerCase()
        if (fileName.includes(kwLower)) {
          fileNameMatchCount++
          if (!matchedKeywords.includes(kw)) matchedKeywords.push(kw)
        }
        if (text.includes(kwLower)) {
          contentMatchCount++
        }
      }

      if (fileNameMatchCount > 0) {
        exactMatches.push(row)
      } else if (contentMatchCount >= Math.ceil(keywords.length * 0.5) && contentMatchCount >= 2) {
        contentMatches.push(row)
      } else if (contentMatchCount > 0) {
        partialMatches.push(row)
      }
    }

    const results = [...exactMatches, ...contentMatches, ...partialMatches].slice(0, limit)

    logDebug('Filename search found matches', 'Search', {
      exactCount: exactMatches.length,
      contentMatchCount: contentMatches.length,
      partialCount: partialMatches.length,
      matchedKeywords,
      sources: [
        ...new Set(results.map((r) => r.source || r.metadata?.source).filter(Boolean))
      ].slice(0, 5)
    })

    return { results, matchedKeywords }
  } catch (e) {
    logDebug('Filename search failed', 'Search', { error: String(e) })
    return { results: [], matchedKeywords: [] }
  }
}
