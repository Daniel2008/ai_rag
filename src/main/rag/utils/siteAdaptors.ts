// 需要使用 Jina Reader 的动态渲染站点（SPA/SSR）
export const DYNAMIC_RENDER_SITES = [
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

export function buildJinaReaderUrl(u: string): string {
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
export function isDynamicRenderSite(url: string): boolean {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.toLowerCase()
    return DYNAMIC_RENDER_SITES.some((site) => hostname.includes(site))
  } catch {
    return false
  }
}

/**
 * 使用 Jina Reader 获取内容（适用于动态渲染站点）
 */
export async function fetchWithJinaReader(
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
        Accept: 'text/plain,text/markdown,*/*;q=0.1',
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

export function isWikipediaUrl(u: string): boolean {
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

export async function fetchWikipediaPlain(u: string, userAgent: string): Promise<string | null> {
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

export function toGitHubRaw(u: string): string | null {
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
