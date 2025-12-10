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
  /** 进度回调函数 */
  onProgress?: (stage: string, percent: number) => void
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

// 需要使用 Jina Reader 的动态渲染站点（SPA/SSR）
const DYNAMIC_RENDER_SITES = [
  'toutiao.com',
  'toutiaocdn.com',
  'jinritoutiao.com',
  'weixin.qq.com',
  'mp.weixin.qq.com',
  'zhihu.com',
  'bilibili.com',
  'douyin.com',
  'xiaohongshu.com',
  'juejin.cn',
  'jianshu.com',
  'csdn.net',
  'segmentfault.com',
  '36kr.com',
  'huxiu.com',
  'sspai.com',
  'infoq.cn'
]

// 常见的内容区域选择器权重
const CONTENT_SELECTORS = [
  { selector: /<article[^>]*>([\s\S]*?)<\/article>/gi, weight: 100 },
  { selector: /<main[^>]*>([\s\S]*?)<\/main>/gi, weight: 90 },
  // 今日头条文章内容
  {
    selector: /<div[^>]*class="[^"]*article-content[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 95
  },
  // 微信公众号文章
  {
    selector: /<div[^>]*id="js_content"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 95
  },
  // 知乎回答/文章
  {
    selector: /<div[^>]*class="[^"]*RichContent-inner[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 95
  },
  // 掘金文章
  {
    selector: /<div[^>]*class="[^"]*article-viewer[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 95
  },
  // CSDN 文章
  {
    selector: /<div[^>]*id="article_content"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 95
  },
  {
    selector:
      /<div[^>]*class="[^"]*(?:post-content|article-content|entry-content|content-body|main-content)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 85
  },
  {
    selector: /<div[^>]*id="[^"]*(?:content|main|article|post)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 80
  },
  {
    selector: /<div[^>]*class="[^"]*(?:content|body|text)[^"]*"[^>]*>([\s\S]*?)<\/div>/gi,
    weight: 70
  },
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
  const textLength = html
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim().length
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
function cleanHtml(
  html: string,
  extractContent: boolean = true
): { title: string; content: string; meta: PageMeta } {
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
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
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
function processContent(
  rawContent: string,
  contentType: string,
  url: string
): { title: string; content: string; meta: PageMeta } {
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
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function buildJinaReaderUrl(u: string): string {
  try {
    const parsed = new URL(u)
    const proto = parsed.protocol.replace(':', '')
    return `https://r.jina.ai/${proto}://${parsed.host}${parsed.pathname}${parsed.search}`
  } catch {
    return `https://r.jina.ai/https://${u}`
  }
}

/**
 * 检查是否是需要动态渲染的站点
 */
function isDynamicRenderSite(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    return DYNAMIC_RENDER_SITES.some(site => hostname.includes(site))
  } catch {
    return false
  }
}

/**
 * 使用 Jina Reader 获取内容（适用于动态渲染站点）
 */
async function fetchWithJinaReader(
  url: string,
  userAgent: string,
  timeout: number = 30000
): Promise<{ success: boolean; content?: string; error?: string }> {
  const jinaUrl = buildJinaReaderUrl(url)
  
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)
    
    const response = await fetch(jinaUrl, {
      signal: controller.signal,
      headers: {
        'User-Agent': userAgent,
        'Accept': 'text/plain,text/markdown,*/*;q=0.1',
        'X-Return-Format': 'markdown'
      }
    })
    
    clearTimeout(timeoutId)
    
    if (!response.ok) {
      return { 
        success: false, 
        error: `Jina Reader 返回错误: ${response.status}` 
      }
    }
    
    const content = await response.text()
    
    // 检查是否是有效内容（Jina Reader 有时返回错误页面）
    if (content.includes('Error') && content.length < 200) {
      return { success: false, error: 'Jina Reader 无法解析该页面' }
    }
    
    return { success: true, content }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      return { success: false, error: 'Jina Reader 请求超时' }
    }
    return { 
      success: false, 
      error: `Jina Reader 请求失败: ${error instanceof Error ? error.message : '未知错误'}` 
    }
  }
}

function isWikipediaUrl(u: string): boolean {
  try {
    const parsed = new URL(u)
    return parsed.hostname.endsWith('wikipedia.org') && parsed.pathname.startsWith('/wiki/')
  } catch {
    return false
  }
}

function getWikipediaLangAndTitle(u: string): { lang: string; title: string } | null {
  try {
    const parsed = new URL(u)
    const lang = parsed.hostname.split('.')[0] || 'en'
    const title = decodeURIComponent(parsed.pathname.replace(/^\/wiki\//, ''))
    return { lang, title }
  } catch {
    return null
  }
}

async function fetchWikipediaPlain(u: string, userAgent: string): Promise<string | null> {
  const info = getWikipediaLangAndTitle(u)
  if (!info) return null
  const url = `https://${info.lang}.wikipedia.org/api/rest_v1/page/plain/${encodeURIComponent(info.title)}`
  try {
    const resp = await fetch(url, {
      headers: {
        'User-Agent': userAgent,
        Accept: 'text/plain,*/*;q=0.1'
      }
    })
    if (!resp.ok) return null
    return await resp.text()
  } catch {
    return null
  }
}

function toGitHubRaw(u: string): string | null {
  try {
    const parsed = new URL(u)
    if (parsed.hostname === 'github.com') {
      const m = parsed.pathname.match(/^\/([^/]+)\/([^/]+)\/blob\/([^/]+)\/(.+)$/)
      if (m) {
        const [, owner, repo, branch, pathPart] = m
        return `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${pathPart}`
      }
    }
    return null
  } catch {
    return null
  }
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
    extractContent: _extractContent = true,
    maxRetries = 2,
    extractLinks = false,
    extractMeta = true,
    minContentLength = 50,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    onProgress
  } = options
  void _extractContent // 保留选项以便将来使用

  let lastError = ''

  // 增强URL格式验证
  try {
    const parsedUrl = new URL(url)
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      // URL格式验证失败
      onProgress?.('URL格式验证失败', 100)
      return { success: false, url, error: '仅支持 HTTP/HTTPS 协议' }
    }
    // 检查域名格式（支持多级域名如 www.example.com、sub.domain.example.co.uk）
    if (!parsedUrl.hostname.match(/^([a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/)) {
      // URL格式验证失败
      onProgress?.('URL格式验证失败', 100)
      return { success: false, url, error: '无效的域名格式' }
    }
    // URL格式验证完成
    onProgress?.('URL格式验证完成', 10)
  } catch (e) {
    // URL格式验证失败
    onProgress?.('URL格式验证失败', 100)
    return {
      success: false,
      url,
      error: `URL格式错误: ${e instanceof Error ? e.message : '未知错误'}`
    }
  }

  // 检查是否是动态渲染站点，优先使用 Jina Reader
  const useDynamicFetch = isDynamicRenderSite(url)
  
  if (useDynamicFetch) {
    console.log(`[urlLoader] 检测到动态渲染站点: ${url}，使用 Jina Reader`)
    onProgress?.('检测到动态站点，使用智能抓取', 15)
    
    const jinaResult = await fetchWithJinaReader(url, userAgent, timeout)
    
    if (jinaResult.success && jinaResult.content) {
      onProgress?.('智能抓取完成', 50)
      
      const content = jinaResult.content
      
      // 从 Markdown 内容中提取标题
      const titleMatch = content.match(/^#\s+(.+)$/m) || content.match(/^(.+)\n={3,}$/m)
      const title = titleMatch ? titleMatch[1].trim() : url
      
      // 清理 Markdown 格式，转换为纯文本（可选）
      const cleanContent = content
        .replace(/^\s*[-*]\s+/gm, '• ') // 列表项
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // 链接
        .replace(/[*_]{1,2}([^*_]+)[*_]{1,2}/g, '$1') // 加粗/斜体
        .replace(/^#+\s+/gm, '') // 标题标记
        .replace(/`{1,3}[^`]*`{1,3}/g, (m) => m.replace(/`/g, '')) // 代码块
        .trim()
      
      if (cleanContent.length < minContentLength) {
        onProgress?.('内容过少', 100)
        return {
          success: false,
          url,
          error: `页面内容过少（${cleanContent.length} 字符），最小要求 ${minContentLength} 字符`
        }
      }
      
      onProgress?.('正在分割文档', 80)
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
        separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
      })
      
      const docs = await splitter.createDocuments(
        [cleanContent],
        [
          {
            source: url,
            title: title,
            type: 'url',
            fetchedAt: new Date().toISOString(),
            siteName: new URL(url).hostname
          }
        ]
      )
      
      onProgress?.('处理完成', 100)
      return {
        success: true,
        url,
        title,
        content: cleanContent,
        documents: docs,
        meta: { title, siteName: new URL(url).hostname },
        contentLength: cleanContent.length
      }
    } else {
      console.log(`[urlLoader] Jina Reader 失败: ${jinaResult.error}，尝试直接抓取`)
      lastError = jinaResult.error || '智能抓取失败'
    }
  }

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 验证 URL
      const parsedUrl = new URL(url)
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        return { success: false, url, error: '仅支持 HTTP/HTTPS 协议' }
      }
      const encodedUrl = parsedUrl.href

      // 开始获取网页内容
      onProgress?.('正在获取网页内容', 20)

      // 发起请求
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeout)

      const response = await fetch(encodedUrl, {
        signal: controller.signal,
        headers: {
          'User-Agent': userAgent,
          Accept:
            'text/html,application/xhtml+xml,application/xml;q=0.9,application/json;q=0.8,text/plain;q=0.7,*/*;q=0.5',
          'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
          'Accept-Encoding': 'identity', // 避免压缩问题
          'Cache-Control': 'no-cache',
          Referer: new URL(encodedUrl).origin
        },
        redirect: 'follow'
      })

      clearTimeout(timeoutId)

      // 内容获取完成
      onProgress?.('内容获取完成', 40)

      if (!response.ok) {
        lastError = `HTTP 错误: ${response.status} ${response.statusText}`
        if (response.status === 429) {
          lastError += ' (请求过于频繁，建议稍后重试)'
        } else if (response.status === 403) {
          lastError += ' (访问被拒绝)'
        } else if (response.status === 404) {
          lastError += ' (页面不存在)'
        } else if (response.status >= 500) {
          lastError += ' (服务器错误)'
        }

        if (response.status === 429 || response.status >= 500) {
          // 可重试的错误
          if (attempt < maxRetries) {
            const retryDelay = 1000 * (attempt + 1)
            await delay(retryDelay)
            continue
          }
        }
        const jrUrl = buildJinaReaderUrl(encodedUrl)
        try {
          const jrResp = await fetch(jrUrl, {
            headers: {
              'User-Agent': userAgent,
              Accept: 'text/plain,*/*;q=0.1'
            }
          })
          if (jrResp.ok) {
            // 备用方案内容获取完成
            onProgress?.('备用方案内容获取完成', 50)
            const jrText = await jrResp.text()
            const contentType = 'text/plain'
            // 处理备用方案内容
            onProgress?.('正在处理内容', 60)
            const { title, content, meta } = processContent(jrText, contentType, url)
            if (!content || content.length < minContentLength) {
              return {
                success: false,
                url,
                error: `页面内容过少（${content.length} 字符），最小要求 ${minContentLength} 字符`
              }
            }
            const links = extractLinks ? extractPageLinks(jrText, url) : undefined
            const splitter = new RecursiveCharacterTextSplitter({
              chunkSize: 1000,
              chunkOverlap: 200,
              separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
            })
            const docs = await splitter.createDocuments(
              [content],
              [
                {
                  source: url,
                  title: title || url,
                  type: 'url',
                  fetchedAt: new Date().toISOString(),
                  ...(extractMeta && meta.description ? { description: meta.description } : {}),
                  ...(extractMeta && meta.author ? { author: meta.author } : {}),
                  ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
                }
              ]
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
          }
        } catch (e) {
          lastError = e instanceof Error ? e.message : '代理抓取失败'
        }
        if (isWikipediaUrl(encodedUrl)) {
          try {
            const wikiText = await fetchWikipediaPlain(encodedUrl, userAgent)
            if (wikiText) {
              const contentType = 'text/plain'
              const { title, content, meta } = processContent(wikiText, contentType, url)
              if (content && content.length >= minContentLength) {
                const splitter = new RecursiveCharacterTextSplitter({
                  chunkSize: 1000,
                  chunkOverlap: 200,
                  separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
                })
                const docs = await splitter.createDocuments(
                  [content],
                  [
                    {
                      source: url,
                      title: title || url,
                      type: 'url',
                      fetchedAt: new Date().toISOString(),
                      ...(extractMeta && meta.description ? { description: meta.description } : {}),
                      ...(extractMeta && meta.author ? { author: meta.author } : {}),
                      ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
                    }
                  ]
                )
                return {
                  success: true,
                  url,
                  title: title || url,
                  content,
                  documents: docs,
                  meta: extractMeta ? meta : undefined,
                  contentLength: content.length
                }
              } else {
                lastError = `维基百科内容过少（${content?.length || 0} 字符），最小要求 ${minContentLength} 字符`
              }
            } else {
              lastError = `无法从维基百科获取内容，可能是API访问限制或页面不存在: ${url}`
            }
          } catch (e) {
            lastError = `维基百科内容处理失败: ${e instanceof Error ? e.message : '未知错误'}`
          }
        }
        const ghRaw = toGitHubRaw(encodedUrl)
        if (ghRaw) {
          try {
            const ghResp = await fetch(ghRaw, {
              headers: {
                'User-Agent': userAgent,
                Accept: '*/*'
              }
            })
            if (ghResp.ok) {
              const ghText = await ghResp.text()
              const contentType = 'text/plain'
              const { title, content, meta } = processContent(ghText, contentType, url)
              if (content && content.length >= minContentLength) {
                const splitter = new RecursiveCharacterTextSplitter({
                  chunkSize: 1000,
                  chunkOverlap: 200,
                  separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
                })
                const docs = await splitter.createDocuments(
                  [content],
                  [
                    {
                      source: url,
                      title: title || url,
                      type: 'url',
                      fetchedAt: new Date().toISOString(),
                      ...(extractMeta && meta.description ? { description: meta.description } : {}),
                      ...(extractMeta && meta.author ? { author: meta.author } : {}),
                      ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
                    }
                  ]
                )
                return {
                  success: true,
                  url,
                  title: title || url,
                  content,
                  documents: docs,
                  meta: extractMeta ? meta : undefined,
                  contentLength: content.length
                }
              } else {
                lastError = `GitHub 内容过少（${content?.length || 0} 字符），最小要求 ${minContentLength} 字符`
              }
            } else {
              lastError = `GitHub 原始内容获取失败，HTTP 状态码: ${ghResp.status}`
            }
          } catch (e) {
            lastError = `GitHub 原始内容抓取失败: ${e instanceof Error ? e.message : '未知错误'}`
          }
        }
        // 重试次数耗尽
        onProgress?.('重试次数耗尽', 100)
        return { success: false, url, error: lastError }
      }

      const contentType = response.headers.get('content-type') || 'text/html'

      // 检查内容类型
      const supportedTypes = [
        'text/html',
        'text/plain',
        'application/json',
        'text/markdown',
        'application/xml',
        'text/xml'
      ]
      const isSupported = supportedTypes.some((t) => contentType.includes(t))

      if (!isSupported) {
        // 内容处理失败
        onProgress?.('内容处理失败', 100)
        return { success: false, url, error: `不支持的内容类型: ${contentType}` }
      }

      // 获取内容
      const rawContent = await response.text()

      // 处理内容
      onProgress?.('正在处理内容', 60)
      const { title, content, meta } = processContent(rawContent, contentType, url)

      if (!content || content.length < minContentLength) {
        // 内容处理失败
        onProgress?.('内容处理失败', 100)
        return {
          success: false,
          url,
          error: `页面内容过少（${content.length} 字符），最小要求 ${minContentLength} 字符`
        }
      }

      // 提取链接
      const links = extractLinks ? extractPageLinks(rawContent, url) : undefined

      // 分割文档
      onProgress?.('正在分割文档', 80)
      const splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1000,
        chunkOverlap: 200,
        separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
      })

      const docs = await splitter.createDocuments(
        [content],
        [
          {
            source: url,
            title: title || url,
            type: 'url',
            fetchedAt: new Date().toISOString(),
            ...(extractMeta && meta.description ? { description: meta.description } : {}),
            ...(extractMeta && meta.author ? { author: meta.author } : {}),
            ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
          }
        ]
      )

      // 处理完成
      onProgress?.('处理完成', 100)
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
          const jrUrl = buildJinaReaderUrl(url)
          try {
            // 使用备用方案获取内容
            onProgress?.('主请求失败，尝试备用方案', 30)
            const jrResp = await fetch(jrUrl, {
              headers: {
                'User-Agent': userAgent,
                Accept: 'text/plain,*/*;q=0.1'
              }
            })
            if (jrResp.ok) {
              const jrText = await jrResp.text()
              const contentType = 'text/plain'
              const { title, content, meta } = processContent(jrText, contentType, url)
              if (!content || content.length < minContentLength) {
                // 内容处理失败
                onProgress?.('内容处理失败', 100)
                lastError = `页面内容过少（${content.length} 字符），最小要求 ${minContentLength} 字符`
              } else {
                const links = extractLinks ? extractPageLinks(jrText, url) : undefined
                // 分割文档
                onProgress?.('正在分割文档', 80)
                const splitter = new RecursiveCharacterTextSplitter({
                  chunkSize: 1000,
                  chunkOverlap: 200,
                  separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
                })
                const docs = await splitter.createDocuments(
                  [content],
                  [
                    {
                      source: url,
                      title: title || url,
                      type: 'url',
                      fetchedAt: new Date().toISOString(),
                      ...(extractMeta && meta.description ? { description: meta.description } : {}),
                      ...(extractMeta && meta.author ? { author: meta.author } : {}),
                      ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
                    }
                  ]
                )
                // 处理完成
                onProgress?.('处理完成', 100)
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
              }
            }
          } catch (e) {
            lastError = e instanceof Error ? e.message : '代理抓取失败'
          }
          if (isWikipediaUrl(url)) {
            try {
              const wikiText = await fetchWikipediaPlain(url, userAgent)
              if (wikiText) {
                const contentType = 'text/plain'
                const { title, content, meta } = processContent(wikiText, contentType, url)
                if (content && content.length >= minContentLength) {
                  const splitter = new RecursiveCharacterTextSplitter({
                    chunkSize: 1000,
                    chunkOverlap: 200,
                    separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
                  })
                  const docs = await splitter.createDocuments(
                    [content],
                    [
                      {
                        source: url,
                        title: title || url,
                        type: 'url',
                        fetchedAt: new Date().toISOString(),
                        ...(extractMeta && meta.description
                          ? { description: meta.description }
                          : {}),
                        ...(extractMeta && meta.author ? { author: meta.author } : {}),
                        ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
                      }
                    ]
                  )
                  return {
                    success: true,
                    url,
                    title: title || url,
                    content,
                    documents: docs,
                    meta: extractMeta ? meta : undefined,
                    contentLength: content.length
                  }
                } else {
                  lastError = `维基百科内容过少（${content?.length || 0} 字符），最小要求 ${minContentLength} 字符`
                }
              } else {
                lastError = `无法从维基百科获取内容，可能是API访问限制或页面不存在: ${url}`
              }
            } catch (e) {
              lastError = `维基百科内容处理失败: ${e instanceof Error ? e.message : '未知错误'}`
            }
          }
          const ghRaw2 = toGitHubRaw(url)
          if (ghRaw2) {
            try {
              const ghResp = await fetch(ghRaw2, {
                headers: {
                  'User-Agent': userAgent,
                  Accept: '*/*'
                }
              })
              if (ghResp.ok) {
                const ghText = await ghResp.text()
                const contentType = 'text/plain'
                const { title, content, meta } = processContent(ghText, contentType, url)
                if (content && content.length >= minContentLength) {
                  const splitter = new RecursiveCharacterTextSplitter({
                    chunkSize: 1000,
                    chunkOverlap: 200,
                    separators: ['\n\n', '\n', '。', '！', '？', '；', '.', '!', '?', ';', ' ', '']
                  })
                  const docs = await splitter.createDocuments(
                    [content],
                    [
                      {
                        source: url,
                        title: title || url,
                        type: 'url',
                        fetchedAt: new Date().toISOString(),
                        ...(extractMeta && meta.description
                          ? { description: meta.description }
                          : {}),
                        ...(extractMeta && meta.author ? { author: meta.author } : {}),
                        ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
                      }
                    ]
                  )
                  return {
                    success: true,
                    url,
                    title: title || url,
                    content,
                    documents: docs,
                    meta: extractMeta ? meta : undefined,
                    contentLength: content.length
                  }
                } else {
                  lastError = `GitHub 内容过少（${content?.length || 0} 字符），最小要求 ${minContentLength} 字符`
                }
              } else {
                lastError = `GitHub 原始内容获取失败，HTTP 状态码: ${ghResp.status}`
              }
            } catch (e) {
              lastError = `GitHub 原始内容抓取失败: ${e instanceof Error ? e.message : '未知错误'}`
            }
          }
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
): Promise<{
  results: UrlLoadResult[]
  documents: Document[]
  successCount: number
  failCount: number
}> {
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
export async function validateUrl(
  url: string,
  timeout: number = 10000
): Promise<{ valid: boolean; error?: string }> {
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
