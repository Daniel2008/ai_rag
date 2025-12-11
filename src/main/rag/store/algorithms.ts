/**
 * 排序与融合算法
 * - RRF (Reciprocal Rank Fusion)
 * - MMR (Maximal Marginal Relevance)
 */

import type { Document } from '@langchain/core/documents'

/**
 * 计算两个向量的余弦相似度
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0
  let dotProduct = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB)
  return denominator > 0 ? dotProduct / denominator : 0
}

/**
 * RRF (Reciprocal Rank Fusion) 算法
 * 用于合并多个检索结果列表
 * @param resultLists 多个结果列表，每个列表按相关性排序
 * @param getKey 获取结果唯一标识的函数
 * @param k RRF 参数，通常为 60
 */
export function reciprocalRankFusion<T>(
  resultLists: T[][],
  getKey: (item: T) => string,
  k: number = 60
): { item: T; score: number }[] {
  const scores = new Map<string, { item: T; score: number }>()

  for (const list of resultLists) {
    for (let rank = 0; rank < list.length; rank++) {
      const item = list[rank]
      const key = getKey(item)
      const rrfScore = 1 / (k + rank + 1)

      const existing = scores.get(key)
      if (existing) {
        existing.score += rrfScore
      } else {
        scores.set(key, { item, score: rrfScore })
      }
    }
  }

  // 按分数降序排序
  return Array.from(scores.values()).sort((a, b) => b.score - a.score)
}

/**
 * 简化版 MMR（基于文本内容去重，不需要向量）
 * @param docs 候选文档列表
 * @param k 返回的文档数量
 * @param lambda 相关性与多样性的平衡参数 (0-1)
 */
export function mmrRerankByContent<T extends { doc: Document; score: number }>(
  docs: T[],
  k: number,
  lambda: number = 0.7
): T[] {
  if (docs.length <= k) return docs

  const selected: T[] = []
  const remaining = [...docs]

  // 选择第一个（最相关的）
  if (remaining.length > 0) {
    const best = remaining.reduce((a, b) => (a.score > b.score ? a : b))
    selected.push(best)
    remaining.splice(remaining.indexOf(best), 1)
  }

  // 贪婪选择剩余文档
  while (selected.length < k && remaining.length > 0) {
    let bestIdx = 0
    let bestMmrScore = -Infinity

    for (let i = 0; i < remaining.length; i++) {
      const candidate = remaining[i]
      const candidateText = candidate.doc.pageContent.toLowerCase()

      // 计算与查询的相关性
      const relevance = candidate.score

      // 计算与已选文档的最大相似度（基于文本重叠）
      let maxSimToSelected = 0
      for (const sel of selected) {
        const selText = sel.doc.pageContent.toLowerCase()
        // 使用 Jaccard 相似度
        const candidateWords = new Set(candidateText.split(/\s+/).filter((w) => w.length > 1))
        const selWords = new Set(selText.split(/\s+/).filter((w) => w.length > 1))
        const intersection = new Set([...candidateWords].filter((x) => selWords.has(x)))
        const union = new Set([...candidateWords, ...selWords])
        const sim = union.size > 0 ? intersection.size / union.size : 0
        maxSimToSelected = Math.max(maxSimToSelected, sim)
      }

      // MMR 分数
      const mmrScore = lambda * relevance - (1 - lambda) * maxSimToSelected

      if (mmrScore > bestMmrScore) {
        bestMmrScore = mmrScore
        bestIdx = i
      }
    }

    selected.push(remaining[bestIdx])
    remaining.splice(bestIdx, 1)
  }

  return selected
}
