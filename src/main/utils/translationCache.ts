/**
 * 翻译结果缓存
 */

interface CacheEntry {
  translated: string
  timestamp: number
}

const translationCache = new Map<string, CacheEntry>()
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7天
const MAX_CACHE_SIZE = 1000 // 最多缓存1000条

/**
 * 生成缓存键
 */
function getCacheKey(query: string, targetLang: 'zh' | 'en'): string {
  return `${targetLang}:${query.toLowerCase().trim()}`
}

/**
 * 清理过期缓存
 */
function cleanExpiredCache(): void {
  const now = Date.now()
  for (const [key, entry] of translationCache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      translationCache.delete(key)
    }
  }
  
  // 如果缓存仍然太大，删除最旧的条目
  if (translationCache.size > MAX_CACHE_SIZE) {
    const entries = Array.from(translationCache.entries())
    entries.sort((a, b) => a[1].timestamp - b[1].timestamp)
    const toDelete = entries.slice(0, translationCache.size - MAX_CACHE_SIZE)
    for (const [key] of toDelete) {
      translationCache.delete(key)
    }
  }
}

/**
 * 获取缓存的翻译结果
 */
export function getCachedTranslation(
  query: string,
  targetLang: 'zh' | 'en'
): string | null {
  cleanExpiredCache()
  const key = getCacheKey(query, targetLang)
  const entry = translationCache.get(key)
  
  if (entry && Date.now() - entry.timestamp < CACHE_TTL) {
    return entry.translated
  }
  
  return null
}

/**
 * 缓存翻译结果
 */
export function cacheTranslation(
  query: string,
  targetLang: 'zh' | 'en',
  translated: string
): void {
  cleanExpiredCache()
  const key = getCacheKey(query, targetLang)
  translationCache.set(key, {
    translated,
    timestamp: Date.now()
  })
}

/**
 * 清除所有缓存
 */
export function clearTranslationCache(): void {
  translationCache.clear()
}

