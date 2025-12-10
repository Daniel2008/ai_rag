/**
 * 查询翻译模块
 * 用于跨语言检索：将查询翻译成目标语言以提高检索准确率
 */
import { getSettings } from '../settings'
import { ChatOpenAI } from '@langchain/openai'
import { ChatOllama } from '@langchain/ollama'
import { ChatAnthropic } from '@langchain/anthropic'
import { ChatZhipuAI } from '@langchain/community/chat_models/zhipuai'

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
async function translateQuery(
  query: string,
  targetLang: 'zh' | 'en'
): Promise<string> {
  const settings = getSettings()
  
  // 如果已经是目标语言，直接返回
  const sourceLang = detectLanguage(query)
  if (sourceLang === targetLang || (sourceLang === 'mixed' && targetLang === 'en')) {
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
    const translated = typeof response.content === 'string' 
      ? response.content.trim() 
      : String(response.content).trim()
    
    console.log(`[translateQuery] Translated "${query}" (${sourceLang}) -> "${translated}" (${targetLang})`)
    return translated
  } catch (error) {
    console.error('[translateQuery] Translation failed:', error)
    // 翻译失败时返回原始查询
    return query
  }
}

/**
 * 生成跨语言查询变体
 * 返回原始查询和翻译后的查询
 */
export async function generateCrossLanguageQueries(
  query: string
): Promise<{ original: string; translated?: string; queries: string[] }> {
  const queryLang = detectLanguage(query)
  
  // 如果查询是混合语言或已经是英文，不需要翻译
  if (queryLang === 'en' || queryLang === 'mixed') {
    return {
      original: query,
      queries: [query]
    }
  }
  
  // 中文查询，尝试翻译成英文
  try {
    const translated = await translateQuery(query, 'en')
    
    // 如果翻译结果与原文相同或非常相似，可能翻译失败
    if (translated === query || translated.length < query.length * 0.3) {
      return {
        original: query,
        queries: [query]
      }
    }
    
    return {
      original: query,
      translated,
      queries: [query, translated] // 同时使用原始查询和翻译后的查询
    }
  } catch (error) {
    console.error('[generateCrossLanguageQueries] Failed to generate translated query:', error)
    return {
      original: query,
      queries: [query]
    }
  }
}

