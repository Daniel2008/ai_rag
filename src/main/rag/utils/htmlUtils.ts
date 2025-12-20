/**
 * 页面元信息
 */
export interface PageMeta {
  title?: string
  description?: string
  keywords?: string[]
  author?: string
  publishDate?: string
  ogImage?: string
  siteName?: string
}

// HTML 实体映射
const HTML_ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
  '&mdash;': '—',
  '&ndash;': '–',
  '&hellip;': '…',
  '&bull;': '•',
  '&lsquo;': '\u2018',
  '&rsquo;': '\u2019',
  '&ldquo;': '\u201C',
  '&rdquo;': '\u201D',
  '&euro;': '€',
  '&pound;': '£',
  '&yen;': '¥',
  '&cent;': '¢'
}

/**
 * 解码 HTML 实体
 */
export function decodeHtmlEntities(text: string): string {
  let result = text

  // 解码命名实体
  for (const [entity, char] of Object.entries(HTML_ENTITIES)) {
    result = result.replace(new RegExp(entity, 'gi'), char)
  }

  // 解码数字实体 (&#123; 或 &#x7B;)
  result = result.replace(/&#(\d+);/g, (_, num) => String.fromCharCode(parseInt(num, 10)))
  result = result.replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))

  // 清理剩余未知实体
  result = result.replace(/&[a-z0-9]+;/gi, ' ')

  return result
}

/**
 * 从 URL 中安全地提取并解码文件名/标题
 * 处理 URL 编码的中文字符（如 %E4%B8%AD%E5%8C%BB -> 中医）
 */
export function extractTitleFromUrl(url: string): string {
  try {
    const lastPart = url.split('/').pop() || url
    // 尝试解码 URL 编码的字符
    return decodeURIComponent(lastPart)
  } catch {
    // 解码失败时返回原始字符串
    return url.split('/').pop() || url
  }
}

/**
 * 提取页面元信息
 */
export function extractMetaInfo(html: string): PageMeta {
  const meta: PageMeta = {}

  // 标题
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleMatch) meta.title = decodeHtmlEntities(titleMatch[1].trim())

  // Meta description
  const descMatch =
    html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)
  if (descMatch) meta.description = decodeHtmlEntities(descMatch[1].trim())

  // Meta keywords
  const keywordsMatch =
    html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']keywords["']/i)
  if (keywordsMatch) {
    meta.keywords = keywordsMatch[1]
      .split(/[,，]/)
      .map((k) => k.trim())
      .filter((k) => k)
  }

  // Author
  const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i)
  if (authorMatch) meta.author = decodeHtmlEntities(authorMatch[1].trim())

  // Publish date
  const dateMatch =
    html.match(
      /<meta[^>]*(?:property=["']article:published_time["']|name=["']publishdate["'])[^>]*content=["']([^"']+)["']/i
    ) || html.match(/<time[^>]*datetime=["']([^"']+)["']/i)
  if (dateMatch) meta.publishDate = dateMatch[1]

  // Open Graph
  const ogImageMatch = html.match(
    /<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i
  )
  if (ogImageMatch) meta.ogImage = ogImageMatch[1]

  const ogSiteMatch = html.match(
    /<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i
  )
  if (ogSiteMatch) meta.siteName = decodeHtmlEntities(ogSiteMatch[1])

  // 如果没有从 meta 获取到 title，尝试从 og:title 获取
  if (!meta.title) {
    const ogTitleMatch = html.match(
      /<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i
    )
    if (ogTitleMatch) meta.title = decodeHtmlEntities(ogTitleMatch[1])
  }

  return meta
}

/**
 * 提取页面链接
 */
export function extractPageLinks(html: string, baseUrl: string): string[] {
  const links: string[] = []
  const linkRegex = /<a[^>]*href=["']([^"'#]+)["'][^>]*>/gi
  let match

  try {
    const base = new URL(baseUrl)

    while ((match = linkRegex.exec(html)) !== null) {
      try {
        const href = match[1].trim()
        if (!href || href.startsWith('javascript:') || href.startsWith('mailto:')) continue

        const absoluteUrl = new URL(href, base).href
        if (absoluteUrl.startsWith('http') && !links.includes(absoluteUrl)) {
          links.push(absoluteUrl)
        }
      } catch {
        // 忽略无效链接
      }
    }
  } catch {
    // 忽略 baseUrl 解析错误
  }

  return links.slice(0, 100) // 限制链接数量
}
