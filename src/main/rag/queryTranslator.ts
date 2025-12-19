/**
 * 查询翻译模块
 * 用于跨语言检索：将查询翻译成目标语言以提高检索准确率
 */
import { getSettings } from '../settings'
import { ChatOpenAI } from '@langchain/openai'
import { ChatOllama } from '@langchain/ollama'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatZhipuAI } from '@langchain/community/chat_models/zhipuai'
import { getCachedTranslation, cacheTranslation } from '../utils/translationCache'

/**
 * 检测文本语言（简单检测）
 */
export function detectLanguage(text: string): 'zh' | 'en' | 'mixed' {
  // 简单的语言检测：检查是否包含中文字符
  const chineseRegex = /[\u4e00-\u9fa5]/
  const englishRegex = /[a-zA-Z]/

  const hasChinese = chineseRegex.test(text)
  const hasEnglish = englishRegex.test(text)

  if (hasChinese && hasEnglish) {
    // 统计中英文字符数量
    const chineseCount = (text.match(/[\u4e00-\u9fa5]/g) || []).length
    const englishCount = (text.match(/[a-zA-Z]/g) || []).length

    return chineseCount > englishCount ? 'zh' : 'en'
  }

  if (hasChinese) return 'zh'
  if (hasEnglish) return 'en'
  return 'mixed'
}

/**
 * 使用 LLM 翻译查询
 */
export async function translateQuery(query: string, targetLang: 'zh' | 'en'): Promise<string> {
  // 检查缓存
  const cached = getCachedTranslation(query, targetLang)
  if (cached) {
    console.log(`[translateQuery] Cache hit for "${query}" -> "${cached}"`)
    return cached
  }

  const settings = getSettings()

  // 如果已经是目标语言，直接返回
  const sourceLang = detectLanguage(query)
  if (sourceLang === targetLang || (sourceLang === 'mixed' && targetLang === 'en')) {
    // 缓存结果（即使是原文）
    cacheTranslation(query, targetLang, query)
    return query
  }

  const sourceLangName = sourceLang === 'zh' ? '中文' : 'English'
  const targetLangName = targetLang === 'zh' ? '中文' : 'English'

  const translatePrompt = `Translate the following ${sourceLangName} query to ${targetLangName}. 
Only return the translated text, do not add any explanation or additional text.

Query: ${query}

Translation:`

  try {
    let model

    // 根据配置创建模型
    if (settings.provider === 'openai') {
      model = new ChatOpenAI({
        modelName: settings.openai.chatModel,
        temperature: 0,
        configuration: {
          baseURL: settings.openai.baseUrl,
          apiKey: settings.openai.apiKey
        }
      })
    } else if (settings.provider === 'ollama') {
      model = new ChatOllama({
        model: settings.ollama.chatModel,
        baseUrl: settings.ollama.baseUrl,
        temperature: 0
      })
    } else if (settings.provider === 'anthropic') {
      model = new ChatAnthropic({
        modelName: settings.anthropic.chatModel,
        temperature: 0,
        anthropicApiKey: settings.anthropic.apiKey
      })
    } else if (settings.provider === 'deepseek') {
      // DeepSeek 使用 OpenAI 兼容 API
      model = new ChatOpenAI({
        apiKey: settings.deepseek.apiKey,
        modelName: settings.deepseek.chatModel,
        temperature: 0,
        configuration: { baseURL: settings.deepseek.baseUrl }
      })
    } else if (settings.provider === 'zhipu') {
      model = new ChatZhipuAI({
        modelName: settings.zhipu.chatModel,
        temperature: 0,
        zhipuAIApiKey: settings.zhipu.apiKey
      })
    } else if (settings.provider === 'moonshot') {
      // Moonshot 使用 OpenAI 兼容 API
      model = new ChatOpenAI({
        apiKey: settings.moonshot.apiKey,
        modelName: settings.moonshot.chatModel,
        temperature: 0,
        configuration: { baseURL: settings.moonshot.baseUrl }
      })
    } else {
      // 如果没有配置 LLM，返回原始查询
      console.log('[translateQuery] No LLM configured, returning original query')
      return query
    }

    const response = await model.invoke(translatePrompt)
    const translated =
      typeof response.content === 'string'
        ? response.content.trim()
        : String(response.content).trim()

    // 缓存翻译结果
    cacheTranslation(query, targetLang, translated)

    console.log(
      `[translateQuery] Translated "${query}" (${sourceLang}) -> "${translated}" (${targetLang})`
    )
    return translated
  } catch (error) {
    console.error('[translateQuery] Translation failed:', error)
    // 翻译失败时返回原始查询
    return query
  }
}

/**
 * 从中文查询中提取核心关键词（人名、专有名词等）
 */
function extractCoreKeywords(query: string): string[] {
  // 移除疑问词和语气词
  const cleanQuery = query
    .replace(/[是什么谁干啥做的吗呢吧呀哪里怎么样如何为什么？?！!。，,、]/g, ' ')
    .trim()

  // 提取2-4字的中文词组（人名、专有名词）
  const keywords = cleanQuery.match(/[\u4e00-\u9fa5]{2,4}/g) || []

  // 过滤常见词
  const commonWords = new Set([
    '介绍',
    '内容',
    '什么',
    '哪些',
    '怎样',
    '如何',
    '为什么',
    '关于',
    '请问',
    '告诉',
    '说说',
    '讲讲',
    '一下',
    '可以',
    '简历',
    '资料',
    '信息',
    '文档',
    '文件',
    '报告'
  ])

  return keywords.filter((kw) => !commonWords.has(kw) && kw.length >= 2)
}

/**
 * 生成查询扩展变体
 * 包括：原始查询、核心关键词、关键词组合
 */
function generateQueryExpansions(query: string): string[] {
  const expansions: string[] = [query]
  const keywords = extractCoreKeywords(query)

  if (keywords.length === 0) return expansions

  // 添加单独的关键词作为查询
  for (const kw of keywords.slice(0, 3)) {
    if (!expansions.includes(kw)) {
      expansions.push(kw)
    }
  }

  // 如果有多个关键词，添加组合
  if (keywords.length >= 2) {
    const combined = keywords.slice(0, 2).join(' ')
    if (!expansions.includes(combined)) {
      expansions.push(combined)
    }
  }

  // 添加"关于+关键词"的变体
  if (keywords.length > 0) {
    const aboutQuery = `关于${keywords[0]}`
    if (!expansions.includes(aboutQuery)) {
      expansions.push(aboutQuery)
    }
  }

  return expansions
}

/**
 * 生成跨语言查询变体
 * 返回原始查询和翻译后的查询
 */
export async function generateCrossLanguageQueries(
  query: string
): Promise<{ original: string; translated?: string; queries: string[] }> {
  const queryLang = detectLanguage(query)

  // 生成中文查询扩展
  const chineseExpansions = queryLang === 'zh' ? generateQueryExpansions(query) : [query]

  // 如果查询是混合语言或已经是英文，不需要翻译
  if (queryLang === 'en' || queryLang === 'mixed') {
    return {
      original: query,
      queries: chineseExpansions
    }
  }

  // 中文查询，尝试翻译成英文
  try {
    const translated = await translateQuery(query, 'en')

    // 如果翻译结果与原文相同或非常相似，可能翻译失败
    if (translated === query || translated.length < query.length * 0.3) {
      return {
        original: query,
        queries: chineseExpansions
      }
    }

    // 合并中文扩展和英文翻译
    const allQueries = [...chineseExpansions, translated]

    return {
      original: query,
      translated,
      queries: [...new Set(allQueries)] // 去重
    }
  } catch (error) {
    console.error('[generateCrossLanguageQueries] Failed to generate translated query:', error)
    return {
      original: query,
      queries: chineseExpansions
    }
  }
}
