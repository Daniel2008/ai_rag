/**
 * LRU 缓存实现
 * 支持 TTL（过期时间）和统计信息
 */

import type { CacheStats } from './types'

/**
 * 增强版 LRU 缓存实现
 * - 支持 TTL（过期时间）
 * - 支持缓存统计
 * - 支持相似键模糊匹配（用于向量缓存场景）
 */
export class LRUCache<K, V> {
  private cache = new Map<K, { value: V; timestamp: number }>()
  private hits = 0
  private misses = 0

  constructor(
    private maxSize: number,
    private ttl: number = 0 // 0 表示永不过期
  ) {}

  get(key: K): V | undefined {
    const entry = this.cache.get(key)
    if (entry !== undefined) {
      // 检查是否过期
      if (this.ttl > 0 && Date.now() - entry.timestamp > this.ttl) {
        this.cache.delete(key)
        this.misses++
        return undefined
      }
      // 刷新顺序：删除后重新插入
      this.cache.delete(key)
      this.cache.set(key, entry)
      this.hits++
      return entry.value
    }
    this.misses++
    return undefined
  }

  set(key: K, value: V): void {
    if (this.cache.has(key)) {
      this.cache.delete(key)
    } else if (this.cache.size >= this.maxSize) {
      // 删除最旧（第一个）
      const firstKey = this.cache.keys().next().value
      if (firstKey !== undefined) this.cache.delete(firstKey)
    }
    this.cache.set(key, { value, timestamp: Date.now() })
  }

  /**
   * 获取相似键的缓存（用于查询向量缓存）
   * 如果查询文本高度相似，可以复用缓存
   */
  getSimilar(key: K, similarity: (a: K, b: K) => number, threshold: number = 0.95): V | undefined {
    for (const [cachedKey, entry] of this.cache.entries()) {
      if (this.ttl > 0 && Date.now() - entry.timestamp > this.ttl) {
        continue
      }
      if (similarity(key, cachedKey) >= threshold) {
        this.hits++
        return entry.value
      }
    }
    this.misses++
    return undefined
  }

  clear(): void {
    this.cache.clear()
    this.hits = 0
    this.misses = 0
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): CacheStats {
    const total = this.hits + this.misses
    return {
      size: this.cache.size,
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? this.hits / total : 0
    }
  }

  /**
   * 清理过期条目
   */
  prune(): number {
    if (this.ttl === 0) return 0
    let pruned = 0
    const now = Date.now()
    for (const [key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttl) {
        this.cache.delete(key)
        pruned++
      }
    }
    return pruned
  }
}
