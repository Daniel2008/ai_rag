/**
 * URL 内容抓取器 - 增强版
 * 从网页 URL 获取内容并转换为文档
 * 支持智能正文提取、多种内容类型、自动编码检测
 */
import { Document } from '@langchain/core/documents'
import { RecursiveCharacterTextSplitter } from '@langchain/textsplitters'
import { SemanticChunkConfig } from './semanticChunker'
import {
  extractPageLinks,
  type PageMeta
} from './utils/htmlUtils'
import {
  processContent
} from './utils/contentExtractor'
import {
  isDynamicRenderSite,
  fetchWithJinaReader,
  buildJinaReaderUrl,
  isWikipediaUrl,
  fetchWikipediaPlain,
  toGitHubRaw
} from './utils/siteAdaptors'
import {
  splitTextToDocuments,
  type ChunkingStrategy
} from './utils/textSplitterUtils'

// Re-export types for compatibility
export type { ChunkingStrategy, PageMeta }

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
  allowedHosts?: string[]
  maxTotalChars?: number
  /** 分块策略，默认 'semantic' */
  chunkingStrategy?: ChunkingStrategy
  /** 语义分块配置 */
  semanticChunkConfig?: SemanticChunkConfig
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

/**
 * 延迟函数
 */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
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
    if (options.allowedHosts && options.allowedHosts.length > 0) {
      const host = parsedUrl.hostname.toLowerCase()
      const allowed = options.allowedHosts.some(
        (h) => host.endsWith(h.toLowerCase()) || host === h.toLowerCase()
      )
      if (!allowed) {
        onProgress?.('域名未授权', 100)
        return { success: false, url, error: '域名未在允许列表中' }
      }
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

      // 使用统一的分块函数
      const chunkStrategy = options.chunkingStrategy ?? 'semantic'
      const docs = await splitTextToDocuments(
        cleanContent,
        {
          source: url,
          title: title,
          type: 'url',
          fetchedAt: new Date().toISOString(),
          siteName: new URL(url).hostname
        },
        chunkStrategy,
        options.semanticChunkConfig
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
        onProgress?.('不支持的内容类型', 100)
        return {
          success: false,
          url,
          error: `不支持的内容类型: ${contentType}`
        }
      }

      const rawContent = await response.text()

      // 处理内容
      onProgress?.('正在处理内容', 60)

      const { title, content, meta } = processContent(rawContent, contentType, url)

      if (!content || content.length < minContentLength) {
        onProgress?.('内容过少', 100)
        return {
          success: false,
          url,
          error: `页面内容过少（${content.length} 字符），最小要求 ${minContentLength} 字符`
        }
      }

      // 提取链接
      const links = extractLinks ? extractPageLinks(rawContent, url) : undefined

      onProgress?.('正在分割文档', 80)

      // 使用统一的分块函数
      const chunkStrategy = options.chunkingStrategy ?? 'semantic'
      const docs = await splitTextToDocuments(
        content,
        {
          source: url,
          title: title || url,
          type: 'url',
          fetchedAt: new Date().toISOString(),
          ...(extractMeta && meta.description ? { description: meta.description } : {}),
          ...(extractMeta && meta.author ? { author: meta.author } : {}),
          ...(extractMeta && meta.siteName ? { siteName: meta.siteName } : {})
        },
        chunkStrategy,
        options.semanticChunkConfig
      )

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
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        lastError = `请求超时 (${timeout}ms)`
      } else {
        lastError = e instanceof Error ? e.message : '请求失败'
      }

      // 重试逻辑
      if (attempt < maxRetries) {
        const retryDelay = 1000 * (attempt + 1)
        onProgress?.(`请求失败: ${lastError}，${retryDelay / 1000}秒后重试...`, 30)
        await delay(retryDelay)
        continue
      }
    }
  }

  onProgress?.('加载失败', 100)
  return {
    success: false,
    url,
    error: `加载失败 (重试 ${maxRetries} 次后): ${lastError}`
  }
}
