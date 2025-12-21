import {
  decodeHtmlEntities,
  extractTitleFromUrl,
  extractMetaInfo,
  type PageMeta
} from './htmlUtils'

// 常见的内容区域选择器权重
export const CONTENT_SELECTORS = [
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
export const NOISE_PATTERNS = [
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
export function extractMainContent(html: string): string {
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
export function cleanHtml(
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
export function processContent(
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
    const title = extractTitleFromUrl(url)
    return {
      title,
      content: rawContent,
      meta: { title }
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
    const title = extractTitleFromUrl(url)
    return {
      title,
      content: rawContent,
      meta: { title }
    }
  }

  // HTML（默认）
  return cleanHtml(rawContent, true)
}
