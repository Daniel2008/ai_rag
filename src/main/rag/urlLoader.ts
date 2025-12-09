/**
 * URL 内容抓取器 - 增强版
 * 从网页 URL 获取内容并转换为文档
 * 支持智能正文提取、多种内容类型、自动编码检测
 */
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'

/** URL 加载选项 */
export interface UrlLoadOptions {
  /** 超时时间（毫秒），默认 30000 */
  timeout?: number
  /** 是否提取正文（去除导航、广告等），默认 true */
  extractContent?: boolean
  /** 最大重试次数，默认 2 */
  maxRetries?: number
  /** 是否提取链接，默认 false */
  extractLinks?: boolean
  /** 是否提取元信息，默认 true */
  extractMeta?: boolean
  /** 最小内容长度，默认 50 */
  minContentLength?: number
  /** 自定义 User-Agent */
  userAgent?: string
}

/** 页面元信息 */
export interface PageMeta {
  title?: string
  description?: string
  keywords?: string[]
  author?: string
  publishDate?: string
  ogImage?: string
  siteName?: string
}

/** URL 加载结果 */
export interface UrlLoadResult {
  success: boolean
  url: string
  title?: string
  content?: string
  documents?: Document[]
  meta?: PageMeta
  links?: string[]
  contentLength?: number
  error?: string
}

// 常见的内容区域选择器权重
const CONTENT_SELECTORS = [
  { selector: /<article[^>]*>([\s\S]*?)<\/article>/gi, weight: 100 },
  { selector: /<main[^>]*>([\s\S]*?)<\/main>/gi, weight: 90 },
  { selector: /<div[^>]*class="[^"]*(?:post-content|article-content|entry-content|content-body|main-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, weight: 85 },
  { selector: /<div[^>]*id="[^"]*(?:content|main|article|post)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, weight: 80 },
  { selector: /<div[^>]*class="[^"]*(?:content|body|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi, weight: 70 },
  { selector: /<section[^>]*class="[^"]*content[^"]*"[^>]*>([\s\S]*?)<\/section>/gi, weight: 65 }
]

// 需要移除的噪音元素
const NOISE_PATTERNS = [
  /<script[^>]*>[\s\S]*?<\/script>/gi,
  /<style[^>]*>[\s\S]*?<\/style>/gi,
  /<noscript[^>]*>[\s\S]*?<\/noscript>/gi,
  /<iframe[^>]*>[\s\S]*?<\/iframe>/gi,
  /<svg[^>]*>[\s\S]*?<\/svg>/gi,
  /<!--[\s\S]*?-->/g,
  /<nav[^>]*>[\s\S]*?<\/nav>/gi,
  /<header[^>]*>[\s\S]*?<\/header>/gi,
  /<footer[^>]*>[\s\S]*?<\/footer>/gi,
  /<aside[^>]*>[\s\S]*?<\/aside>/gi,
  /<form[^>]*>[\s\S]*?<\/form>/gi,
  /<div[^>]*class="[^"]*(?:sidebar|widget|comment|share|social|related|recommend|ad|advertisement|banner)[^"]*"[^>]*>[\s\S]*?<\/div>/gi,
  /<div[^>]*id="[^"]*(?:sidebar|widget|comment|share|social|related|recommend|ad|advertisement|banner)[^"]*"[^>]*>[\s\S]*?<\/div>/gi
]

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
function decodeHtmlEntities(text: string): string {
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
 * 提取页面元信息
 */
function extractMetaInfo(html: string): PageMeta {
  const meta: PageMeta = {}

  // 标题
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i)
  if (titleMatch) meta.title = decodeHtmlEntities(titleMatch[1].trim())

  // Meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']description["']/i)
  if (descMatch) meta.description = decodeHtmlEntities(descMatch[1].trim())

  // Meta keywords
  const keywordsMatch = html.match(/<meta[^>]*name=["']keywords["'][^>]*content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']keywords["']/i)
  if (keywordsMatch) {
    meta.keywords = keywordsMatch[1].split(/[,，]/).map(k => k.trim()).filter(k => k)
  }

  // Author
  const authorMatch = html.match(/<meta[^>]*name=["']author["'][^>]*content=["']([^"']+)["']/i)
  if (authorMatch) meta.author = decodeHtmlEntities(authorMatch[1].trim())

  // Publish date
  const dateMatch = html.match(/<meta[^>]*(?:property=["']article:published_time["']|name=["']publishdate["'])[^>]*content=["']([^"']+)["']/i) ||
    html.match(/<time[^>]*datetime=["']([^"']+)["']/i)
  if (dateMatch) meta.publishDate = dateMatch[1]

  // Open Graph
  const ogImageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
  if (ogImageMatch) meta.ogImage = ogImageMatch[1]

  const ogSiteMatch = html.match(/<meta[^>]*property=["']og:site_name["'][^>]*content=["']([^"']+)["']/i)
  if (ogSiteMatch) meta.siteName = decodeHtmlEntities(ogSiteMatch[1])

  // 如果没有从 meta 获取到 title，尝试从 og:title 获取
  if (!meta.title) {
    const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
    if (ogTitleMatch) meta.title = decodeHtmlEntities(ogTitleMatch[1])
  }

  return meta
}

/**
 * 提取页面链接
 */
function extractPageLinks(html: string, baseUrl: string): string[] {
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

/**
 * 计算文本密度得分（用于判断内容质量）
 */
function calculateTextDensity(html: string): number {
  const textLength = html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().length
  const htmlLength = html.length
  return htmlLength > 0 ? textLength / htmlLength : 0
}

/**
 * 智能提取正文内容
 */
function extractMainContent(html: string): string {
  let bestContent = ''
  let bestScore = 0

  // 首先移除噪音元素
  let cleanedHtml = html
  for (const pattern of NOISE_PATTERNS) {
    cleanedHtml = cleanedHtml.replace(pattern, '')
  }

  // 尝试各种内容选择器
  for (const { selector, weight } of CONTENT_SELECTORS) {
    const regex = new RegExp(selector.source, selector.flags)
    let match

    while ((match = regex.exec(cleanedHtml)) !== null) {
      const content = match[1] || match[0]
      const density = calculateTextDensity(content)
      const length = content.replace(/<[^>]+>/g, '').length
      const score = weight * density * Math.log(length + 1)

      if (score > bestScore && length > 100) {
        bestScore = score
        bestContent = content
      }
    }
  }

  // 如果没有找到好的内容区域，使用 body
  if (!bestContent || bestScore < 10) {
    const bodyMatch = cleanedHtml.match(/<body[^>]*>([\s\S]*)<\/body>/i)
    bestContent = bodyMatch ? bodyMatch[1] : cleanedHtml
  }

  return bestContent
}

/**
 * 清理 HTML，提取纯文本内容
 */
function cleanHtml(html: string, extractContent: boolean = true): { title: string; content: string; meta: PageMeta } {
  // 提取元信息
  const meta = extractMetaInfo(html)

  // 提取正文区域
  let content = extractContent ? extractMainContent(html) : html

  // 将块级元素转换为换行
  content = content
    .replace(/<\/?(h[1-6])[^>]*>/gi, '\n\n')
    .replace(/<\/?(p|div|br|blockquote)[^>]*>/gi, '\n')
    .replace(/<\/?(li)[^>]*>/gi, '\n• ')
    .replace(/<\/?(ul|ol|table|tbody|thead|tr)[^>]*>/gi, '\n\n')
    .replace(/<td[^>]*>/gi, '\t')
    .replace(/<\/td>/gi, '')

  // 保留链接文本
  content = content.replace(/<a[^>]*>([^<]*)<\/a>/gi, '$1')

  // 移除所有剩余的 HTML 标签
  content = content.replace(/<[^>]+>/g, '')

  // 解码 HTML 实体
  content = decodeHtmlEntities(content)

  // 清理多余空白
  content = content
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+/g, ' ')
    .trim()

  return {
    title: meta.title || '',
    content,
    meta
  }
}

/**
 * 检测内容类型并处理
 */
function processContent(rawContent: string, contentType: string, url: string): { title: string; content: string; meta: PageMeta } {
  // JSON 内容
  if (contentType.includes('application/json')) {
    try {
      const json = JSON.parse(rawContent)
      const content = JSON.stringify(json, null, 2)
      return {
        title: `JSON: ${url}`,
        content,
        meta: { title: `JSON: ${url}` }
      }
    } catch {
      return { title: url, content: rawContent, meta: {} }
    }
  }

  // Markdown 内容
  if (contentType.includes('text/markdown') || url.endsWith('.md')) {
    return {
      title: url.split('/').pop() || url,
      content: rawContent,
      meta: { title: url.split('/').pop() || url }
    }
  }

  // XML 内容
  if (contentType.includes('application/xml') || contentType.includes('text/xml')) {
    // 简单提取 XML 文本内容
    const content = rawContent
      .replace(/<\?xml[^>]*\?>/gi, '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
      .replace(/<[^>]+>/g, '\n')
      .replace(/\n{2,}/g, '\n')
      .trim()
    return {
      title: `XML: ${url}`,
      content,
      meta: { title: `XML: ${url}` }
    }
  }

  // 纯文本
  if (contentType.includes('text/plain')) {
    return {
      title: url.split('/').pop() || url,
      content: rawContent,
      meta: { title: url.split('/').pop() || url }
    }
  }

  // HTML（默认）
  return cleanHtml(rawContent, true)
}

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 从 URL 加载内容（带重试）
 */
export async function loadFromUrl(
  url: string,
  options: UrlLoadOptions = {}
): Promise<UrlLoadResult> {
  const {
    timeout = 30000,
    extractContent = true,
    maxRetries = 2,
    extractLinks = false,
    extractMeta = true,
    minContentLength = 50,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  } = options

  let lastError = ''

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 验证 URL
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, url, error: '仅支持 HTTP/HTTPS 协议' }
      }

      // 发起请求
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'identity', // 避免压缩问题
          'Cache-Control': 'no-cache'
        },
        redirect: 'follow'
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        lastError = `HTTP 错误: ${response.status} ${response.statusText}`
        if (response.status === 429 || response.status >= 500) {
          // 可重试的错误
          if (attempt < maxRetries) {
            await delay(1000 * (attempt + 1))
            continue
          }
        }
        return { success: false, url, error: lastError }
      }

      const contentType = response.headers.get('content-type') || 'text/html'

      // 检查内容类型
      const supportedTypes = ['text/html', 'text/plain', 'application/json', 'text/markdown', 'application/xml', 'text/xml']
      const isSupported = supportedTypes.some(t => contentType.includes(t))

      if (!isSupported) {
        return { success: false, url, error: `不支持的内容类型: ${contentType}` }
      }

      // 获取内容
      const rawContent = await response.text()

      // 处理内容
      const { title, content, meta } = processContent(rawContent, contentType, url)

      if (!content || content.length < minContentLength) {
        return { success: false, url, error: `页面内容过少（${content.length} 字符），最小要求 ${minContentLength} 字符` }
      }

      // 提取链接
      const links = extractLinks ? extractPageLinks(rawContent, url) : undefined

      // 分割文档
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
        separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
      })

      const docs = await splitter.createDocuments(
        [content],
        [{
          source: url,
          title: title || url,
          type: 'url',
          fetchedAt: new Date().toISOString(),
          ...(extractMeta && meta.description ? { description: meta.description } : {}),
          ...(extractMeta && meta.author ? { author: meta.author } : {}),
          ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
        }]
      )

      return {
        success: true,
        url,
        title: title || url,
        content,
        documents: docs,
        meta: extractMeta ? meta : undefined,
        links,
        contentLength: content.length
      }

    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          lastError = '请求超时'
        } else if (error.message.includes('fetch')) {
          lastError = '网络连接失败'
        } else {
          lastError = error.message
        }
      } else {
        lastError = '未知错误'
      }

      // 网络错误可以重试
      if (attempt < maxRetries) {
        await delay(1000 * (attempt + 1))
        continue
      }
    }
  }

  return { success: false, url, error: lastError }
}

/**
 * 批量加载多个 URL（并发控制）
 */
export async function loadFromUrls(
  urls: string[],
  options: UrlLoadOptions = {},
  onProgress?: (current: number, total: number, url: string, result?: UrlLoadResult) => void
): Promise<{ results: UrlLoadResult[]; documents: Document[]; successCount: number; failCount: number }> {
  const results: UrlLoadResult[] = []
  const allDocuments: Document[] = []
  let successCount = 0
  let failCount = 0

  // 去重
  const uniqueUrls = [...new Set(urls)]

  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i]
    onProgress?.(i + 1, uniqueUrls.length, url)

    const result = await loadFromUrl(url, options)
    results.push(result)

    if (result.success && result.documents) {
      allDocuments.push(...result.documents)
      successCount++
    } else {
      failCount++
    }

    onProgress?.(i + 1, uniqueUrls.length, url, result)

    // 避免请求过快，动态调整延迟
    if (i < uniqueUrls.length - 1) {
      const delayMs = result.success ? 300 : 500
      await delay(delayMs)
    }
  }

  return { results, documents: allDocuments, successCount, failCount }
}

/**
 * 验证 URL 是否可访问
 */
export async function validateUrl(url: string, timeout: number = 10000): Promise<{ valid: boolean; error?: string }> {
  try {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return { valid: false, error: '仅支持 HTTP/HTTPS 协议' }
    }

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    const response = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; URLValidator/1.0)'
      }
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      return { valid: false, error: `HTTP ${response.status}` }
    }

    return { valid: true }
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        return { valid: false, error: '连接超时' }
      }
      return { valid: false, error: error.message }
    }
    return { valid: false, error: '无法访问' }
  }
}
