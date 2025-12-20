import { getSettings } from '../settings'
import { logDebug } from '../utils/logger'

export interface WebSearchResult {
  title: string
  url: string
  content: string
}

/**
 * 联网搜索类
 */
export class WebSearcher {
  private apiKey: string | undefined

  constructor() {
    const settings = getSettings()
    this.apiKey = settings.rag.tavilyApiKey
  }

  async search(query: string): Promise<WebSearchResult[]> {
    if (!this.apiKey) {
      logDebug('WebSearcher: No API key found, skipping web search.', 'WebSearch')
      return []
    }

    try {
      logDebug(`WebSearcher: Searching for "${query}"`, 'WebSearch')

      // 这里以 Tavily 为例，如果没有 key 则返回空
      const response = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          api_key: this.apiKey,
          query: query,
          search_depth: 'basic',
          include_answer: false,
          max_results: 5
        })
      })

      if (!response.ok) {
        throw new Error(`Tavily API error: ${response.statusText}`)
      }

      const data: unknown = await response.json()
      const results = (data as { results?: unknown[] } | null)?.results
      if (!Array.isArray(results)) return []
      return results.map((r) => {
        const obj = r as { title?: unknown; url?: unknown; content?: unknown }
        return {
          title: typeof obj.title === 'string' ? obj.title : '',
          url: typeof obj.url === 'string' ? obj.url : '',
          content: typeof obj.content === 'string' ? obj.content : ''
        }
      })
    } catch (error) {
      logDebug(`WebSearcher error: ${error}`, 'WebSearch')
      return []
    }
  }
}

/**
 * 格式化搜索结果为 RAG 上下文
 */
export function formatSearchResults(results: WebSearchResult[]): string {
  if (results.length === 0) return ''

  return results
    .map((r, i) => {
      return `[网络来源 ${i + 1}]: ${r.title}\nURL: ${r.url}\n内容: ${r.content}`
    })
    .join('\n\n')
}
