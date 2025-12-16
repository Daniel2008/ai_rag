/**
 * 向量存储工具函数
 */

import type { Document } from '@langchain/core/documents'
import type { QueryIntent } from './types'
import { RAG_CONFIG } from '../../utils/config'

/**
 * 标准化路径格式（统一小写和斜杠）
 */
export function normalizePath(p: string): string {
  return p.toLowerCase().replace(/\\/g, '/').trim()
}

/**
 * 转义谓词值中的特殊字符
 */
export function escapePredicateValue(value: string): string {
  return value.replace(/"/g, '\\"')
}

/**
 * 计算最优检索数量 fetchK
 */
export function calculateFetchK(k: number, docCount: number, isGlobalSearch: boolean): number {
  const { SEARCH } = RAG_CONFIG
  const baseFetchK = isGlobalSearch
    ? Math.max(
        k * SEARCH.GLOBAL_SEARCH_MULTIPLIER,
        Math.min(
          SEARCH.MAX_FETCH_K,
          Math.max(SEARCH.MIN_FETCH_K, Math.floor(docCount * SEARCH.GLOBAL_SEARCH_RATIO))
        )
      )
    : Math.max(k * SEARCH.FILTERED_SEARCH_MULTIPLIER, SEARCH.MIN_FETCH_K)
  return Math.max(baseFetchK, k * 10)
}

/**
 * 估计查询复杂度 (0-1)
 */
export function estimateQueryComplexity(query: string): number {
  const lengthScore = Math.min(1, query.length / 200)
  const tokenScore = Math.min(1, query.split(/\s+/).filter(Boolean).length / 30)
  const punctuationScore = Math.min(1, (query.match(/[，。？！?,.!;:]/g)?.length || 0) / 10)
  const distinctScore = Math.min(
    1,
    new Set(query.toLowerCase().split(/\s+/).filter(Boolean)).size / 30
  )
  return Math.min(1, 0.4 * lengthScore + 0.3 * tokenScore + 0.2 * distinctScore + 0.1 * punctuationScore)
}

/**
 * 分类查询意图
 */
export function classifyQueryIntent(query: string): QueryIntent {
  const q = query.toLowerCase()
  const defKw = ['是什么', '定义', '解释', 'meaning', 'definition', 'explain', 'what is', 'define']
  const sumKw = ['总结', '概括', '汇总', 'overview', 'summary', 'summarize']
  const cmpKw = ['比较', '对比', '差异', 'vs', 'difference', 'compare']
  
  // console.log('Checking intent for:', q)
  if (defKw.some((k) => q.includes(k))) return 'definition'
  if (sumKw.some((k) => q.includes(k))) return 'summary'
  if (cmpKw.some((k) => q.includes(k))) return 'comparison'
  return 'other'
}

/**
 * 按来源过滤文档结果
 */
export function filterResultsBySource<T extends { doc: Document }>(
  results: T[],
  sources: string[]
): T[] {
  if (!sources || sources.length === 0) return results

  const sourceSet = new Set(sources.map((s) => normalizePath(s)))

  return results.filter(({ doc }) => {
    const docSource = doc.metadata?.source ? normalizePath(String(doc.metadata.source)) : ''
    if (sourceSet.has(docSource)) return true
    // 模糊匹配：处理路径格式差异
    if (sourceSet.size < 50) {
      for (const s of sourceSet) {
        if (docSource.endsWith(s) || s.endsWith(docSource)) return true
      }
    }
    return false
  })
}

/**
 * 将距离转换为相似度分数 [0, 1]
 * 使用 1 / (1 + distance) 公式
 */
export function distanceToScore(distance: number): number {
  return Math.max(0, Math.min(1, 1 / (1 + distance)))
}

/**
 * 构建来源过滤的 where 子句
 */
export function buildSourceWhereClause(sources: string[]): string {
  const normalizedSources = sources.map((s) => normalizePath(s))
  const escapedSources = normalizedSources.map((s) => `"${escapePredicateValue(s)}"`)
  return `source IN (${escapedSources.join(', ')}) OR metadata.source IN (${escapedSources.join(', ')})`
}

/**
 * 对结果按来源分组进行多样化处理
 */
export function diversifyBySource(
  results: Array<{ doc: Document; score: number }>,
  targetCount: number
): Array<{ doc: Document; score: number }> {
  const bySource = new Map<string, Array<{ doc: Document; score: number }>>()
  for (const r of results) {
    const s = String(r.doc.metadata?.source || '')
    const arr = bySource.get(s) || []
    arr.push(r)
    bySource.set(s, arr)
  }
  
  const groups = Array.from(bySource.values()).map((arr) =>
    arr.sort((a, b) => b.score - a.score)
  )
  
  const diversified: Array<{ doc: Document; score: number }> = []
  let idx = 0
  while (diversified.length < targetCount) {
    let added = false
    for (const g of groups) {
      if (idx < g.length) {
        diversified.push(g[idx])
        added = true
        if (diversified.length >= targetCount) break
      }
    }
    if (!added) break
    idx++
  }
  return diversified
}
