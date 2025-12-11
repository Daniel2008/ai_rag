import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import { searchSimilarDocumentsWithScores, getDocCount, withEmbeddingProgressSuppressed } from './store'
import { RunnableSequence } from '@langchain/core/runnables'
import { Document } from '@langchain/core/documents'
import { getSettings } from '../settings'
import type { ChatSource, ChatResult } from '../../types/chat'
import { RAG_CONFIG } from '../utils/config'
import { createChatModel } from '../utils/createChatModel'
import { logDebug, logInfo, logWarn } from '../utils/logger'

// 重新导出共享类型，保持向后兼容
export type { ChatSource, ChatResult } from '../../types/chat'

interface ChatOptions {
  sources?: string[]
}

// ==================== 辅助函数 ====================

/** 根据文件名推断文件类型 */
function inferFileType(fileName: string): ChatSource['fileType'] {
  const ext = fileName.split('.').pop()?.toLowerCase()
  const typeMap: Record<string, ChatSource['fileType']> = {
    pdf: 'pdf',
    doc: 'word',
    docx: 'word',
    txt: 'text',
    md: 'markdown',
    markdown: 'markdown'
  }
  
  if (ext && typeMap[ext]) return typeMap[ext]
  
  // 检查是否是 URL
  if (fileName.startsWith('http://') || fileName.startsWith('https://')) {
    return 'url'
  }
  return 'unknown'
}

/** 判断路径是否为 URL */
function isUrlPath(path: string): boolean {
  return path.startsWith('http://') || path.startsWith('https://')
}

/** 从文件路径提取文件名 */
function extractFileName(filePath: string, title?: string): string {
  if (title) return title
  
  const pathPart = filePath.split(/[\\/]/).pop() || 'Unknown'
  try {
    return decodeURIComponent(pathPart)
  } catch {
    return pathPart
  }
}

/** 去重：相同文件+页码只保留最相关的一个 */
function deduplicateSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Map<string, ChatSource>()

  for (const source of sources) {
    const key = `${source.fileName}:${source.pageNumber || 0}`
    const existing = seen.get(key)

    // 保留分数更高的
    if (!existing || (source.score || 0) > (existing.score || 0)) {
      seen.set(key, source)
    }
  }

  return Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0))
}

/** 确保来源多样性：从不同文件中选取结果 */
function ensureSourceDiversity(
  pairs: { doc: Document; score: number }[],
  minSources: number = 3,
  maxPerSource: number = 2
): { doc: Document; score: number }[] {
  if (pairs.length === 0) return pairs

  // 按来源分组
  const bySource = new Map<string, { doc: Document; score: number }[]>()
  for (const pair of pairs) {
    const source = pair.doc.metadata?.source || 'unknown'
    if (!bySource.has(source)) {
      bySource.set(source, [])
    }
    bySource.get(source)!.push(pair)
  }

  // 如果来源数量已经足够，直接返回
  if (bySource.size >= minSources) {
    // 但仍然限制每个来源的数量
    const result: { doc: Document; score: number }[] = []
    for (const [, sourcePairs] of bySource) {
      result.push(...sourcePairs.slice(0, maxPerSource))
    }
    return result.sort((a, b) => b.score - a.score)
  }

  // 来源不足，采用轮询策略选取，确保多样性
  const result: { doc: Document; score: number }[] = []
  const sourceEntries = Array.from(bySource.entries())
  
  // 每轮从每个来源取一个
  for (let round = 0; round < maxPerSource; round++) {
    for (const [, sourcePairs] of sourceEntries) {
      if (round < sourcePairs.length) {
        result.push(sourcePairs[round])
      }
    }
  }

  return result.sort((a, b) => b.score - a.score)
}

/** 将检索到的文档转换为来源信息 */
function convertDocsToSources(
  docs: Document[],
  scores: number[]
): ChatSource[] {
  return docs.map((doc, index) => {
    const metadata = doc.metadata || {}
    const filePath = typeof metadata.source === 'string' ? metadata.source : undefined
    const isUrl = filePath ? isUrlPath(filePath) : false
    const fileName = extractFileName(filePath || '', metadata.title || metadata.fileName)
    
    const rawPageNumber = typeof metadata.pageNumber === 'number'
      ? metadata.pageNumber
      : typeof metadata.loc?.pageNumber === 'number'
        ? metadata.loc.pageNumber
        : undefined

    const fileType = metadata.fileType || metadata.type || (isUrl ? 'url' : inferFileType(fileName))
    const score = scores[index] ?? (1 - index * 0.15)

    return {
      content: doc.pageContent.slice(0, 300) + (doc.pageContent.length > 300 ? '...' : ''),
      fileName,
      pageNumber: rawPageNumber && rawPageNumber > 0 ? rawPageNumber : undefined,
      filePath,
      fileType: fileType as ChatSource['fileType'],
      score: Math.max(0, score),
      position: typeof metadata.position === 'number' ? metadata.position : undefined,
      sourceType: metadata.sourceType || (isUrl || metadata.type === 'url' ? 'url' : 'file'),
      siteName: metadata.siteName,
      url: isUrl || metadata.type === 'url' ? filePath : undefined,
      fetchedAt: metadata.fetchedAt || metadata.importedAt
    }
  })
}

/** 构建 RAG 提示词 */
function buildPrompt(context: string, question: string, isGlobalSearch: boolean): string {
  const contextInfo = isGlobalSearch
    ? '以下是从整个知识库中检索到的相关内容：'
    : '以下是从指定文档中检索到的相关内容：'

  if (context.trim()) {
    return `你是一个专业的知识助手。${contextInfo}

上下文内容：
${context}

用户问题：${question}

请基于以上上下文内容回答用户的问题。如果上下文中没有相关信息，请如实告知用户"根据检索到的内容，未找到与您问题直接相关的信息"，并尝试基于你已有的知识给出帮助。`
  }

  return `你是一个专业的知识助手。用户的问题是：${question}

当前知识库中未检索到与此问题直接相关的内容。请基于你已有的知识尽可能帮助用户回答这个问题，并友好地提示用户可以上传相关文档以获得更精准的回答。`
}

// DeepSeek Reasoner 专用流式请求（支持 reasoning_content）
async function* streamDeepSeekReasoner(
  apiKey: string,
  baseUrl: string,
  model: string,
  prompt: string
): AsyncGenerator<string> {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: true
    })
  })

  if (!response.ok) {
    throw new Error(`DeepSeek API error: ${response.status} ${response.statusText}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  const decoder = new TextDecoder()
  let buffer = ''
  let hasStartedThinking = false
  let hasEndedThinking = false

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const json = JSON.parse(data)
        const delta = json.choices?.[0]?.delta

        // 处理思维链内容
        if (delta?.reasoning_content) {
          if (!hasStartedThinking) {
            yield '<think>'
            hasStartedThinking = true
          }
          yield delta.reasoning_content
        }

        // 处理正常内容
        if (delta?.content) {
          if (hasStartedThinking && !hasEndedThinking) {
            yield '</think>'
            hasEndedThinking = true
          }
          yield delta.content
        }
      } catch {
        // 忽略解析错误
      }
    }
  }

  // 确保思维链标签闭合
  if (hasStartedThinking && !hasEndedThinking) {
    yield '</think>'
  }
}

// ==================== 主要导出函数 ====================

export async function chatWithRag(
  question: string,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const settings = getSettings()
  const isGlobalSearch = !options.sources || options.sources.length === 0

  logDebug('Starting RAG chat', 'Chat', {
    question: question.slice(0, 50),
    sourcesCount: options.sources?.length ?? 0
  })

  // 1. 检索相似文档 - 增加检索数量以获取更多样的来源
  const retrievedPairs = await withEmbeddingProgressSuppressed(() =>
    searchSimilarDocumentsWithScores(question, {
      k: 12, // 增加检索数量提高命中率
      sources: options.sources
    })
  )

  logDebug('Retrieved documents', 'Chat', {
    count: retrievedPairs.length,
    topScore: retrievedPairs[0]?.score.toFixed(3)
  })

  // 检查来源多样性
  const uniqueSourcCount = new Set(retrievedPairs.map(p => p.doc.metadata?.source)).size
  logDebug('Source diversity', 'Chat', { uniqueSources: uniqueSourcCount })

  // 2. 检查索引状态
  if (retrievedPairs.length === 0) {
    const docCount = await getDocCount()
    if (docCount === 0) {
      const msg = '知识库索引为空或已丢失。如果您刚刚切换了嵌入模型，请等待后台索引重建完成；否则请在侧边栏中点击"重建索引"。'
      return {
        stream: (async function* () { yield msg })(),
        sources: []
      }
    }
  }

  // 3. 根据相关度阈值过滤文档 - 使用渐进式阈值策略
  const RELEVANCE_THRESHOLD = RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD
  const RELEVANCE_THRESHOLD_LOW = RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD_LOW ?? 0.10
  let effectivePairs = retrievedPairs

  if (retrievedPairs.length > 0) {
    const topScore = retrievedPairs[0]?.score ?? 0
    const topSource = retrievedPairs[0]?.doc.metadata?.source || ''
    
    // 提取查询关键词（人名通常2-3字）
    const queryKeywords = question.match(/[\u4e00-\u9fa5]{2,4}/g) || []
    const fileNameMatchesQuery = queryKeywords.some(kw => 
      topSource.toLowerCase().includes(kw.toLowerCase())
    )
    
    // 渐进式阈值策略：
    // 1. 如果最高分 >= 阈值，保留所有高于低阈值的结果
    // 2. 如果最高分 < 阈值但有结果，使用低阈值兜底
    // 3. 文件名匹配时使用最低阈值
    let effectiveThreshold: number
    if (fileNameMatchesQuery) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW
    } else if (topScore >= RELEVANCE_THRESHOLD) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW // 有高分时也放宽低分限制
    } else if (topScore >= RELEVANCE_THRESHOLD_LOW) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW // 使用低阈值兜底
    } else {
      effectiveThreshold = 0 // 实在太低就全部保留让模型判断
    }
    
    effectivePairs = retrievedPairs.filter((p) => {
      if (p.score >= effectiveThreshold) return true
      // 检查该文档的文件名是否匹配查询
      const source = p.doc.metadata?.source || ''
      return queryKeywords.some(kw => source.toLowerCase().includes(kw.toLowerCase()))
    })
    
    logDebug('Filtered by relevance threshold', 'Chat', {
      before: retrievedPairs.length,
      after: effectivePairs.length,
      threshold: effectiveThreshold,
      topScore: topScore.toFixed(3),
      fileNameMatch: fileNameMatchesQuery
    })
  }

  // 4. 兜底：针对指定来源的查询，尝试直接加载文档
  if (effectivePairs.length === 0 && options.sources && options.sources.length > 0) {
    effectivePairs = await loadFallbackContext(options.sources)
  }

  // 5. 确保来源多样性并构建上下文
  const diversePairs = ensureSourceDiversity(effectivePairs, 3, 2)
  const effectiveDocs = diversePairs.map((p) => p.doc)
  const effectiveScores = diversePairs.map((p) => p.score)
  const context = effectiveDocs.map((doc) => doc.pageContent).join('\n\n')
  
  const sources = convertDocsToSources(effectiveDocs, effectiveScores)
  const uniqueSources = deduplicateSources(sources)

  logDebug('Final sources', 'Chat', {
    sourceCount: uniqueSources.length,
    fileNames: uniqueSources.map(s => s.fileName).join(', ')
  })

  logDebug('Context built', 'Chat', { docCount: effectiveDocs.length })

  // 6. 生成回答
  const promptText = buildPrompt(context, question, isGlobalSearch)

  // 检查是否是 DeepSeek Reasoner 模型
  if (settings.provider === 'deepseek' && settings.deepseek.chatModel.includes('reasoner')) {
    logInfo('Using DeepSeek Reasoner', 'Chat')
    const config = settings.deepseek
    if (!config.apiKey) {
      throw new Error('DeepSeek API Key 未设置，请在设置中配置')
    }
    const stream = streamDeepSeekReasoner(
      config.apiKey,
      config.baseUrl || 'https://api.deepseek.com',
      config.chatModel,
      promptText
    )
    return { stream, sources: uniqueSources }
  }

  // 其他模型使用 LangChain
  const template = buildPrompt('{context}', '{question}', isGlobalSearch)

  const prompt = PromptTemplate.fromTemplate(template)
  const model = createChatModel(settings.provider)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  const stream = await chain.stream({ context, question })

  return { stream, sources: uniqueSources }
}

/** 加载兜底上下文（当检索失败时） */
async function loadFallbackContext(
  sources: string[]
): Promise<{ doc: Document; score: number }[]> {
  try {
    const fallbackDocs: Document[] = []
    
    for (const s of sources) {
      if (isUrlPath(s)) {
        const { loadFromUrl } = await import('./urlLoader')
        const res = await loadFromUrl(s)
        if (res.success && res.documents) {
          fallbackDocs.push(...res.documents.slice(0, 2))
        }
      } else {
        const { loadAndSplitFileInWorker } = await import('./workerManager')
        const docs = await loadAndSplitFileInWorker(s)
        fallbackDocs.push(...docs.slice(0, 2))
      }
    }
    
    // 兜底文档使用较低的分数
    return fallbackDocs.slice(0, 4).map((doc, i) => ({
      doc,
      score: 0.3 - i * 0.05
    }))
  } catch (e) {
    logWarn('Fallback context load failed', 'Chat', undefined, e as Error)
    return []
  }
}

export async function generateConversationTitle(question: string, answer: string): Promise<string> {
  const settings = getSettings()
  const model = createChatModel(settings.provider)

  const template = `Summarize the following conversation into a short title (max 10 characters).
Only return the title, nothing else. Do not use quotes.

Question: {question}
Answer: {answer}

Title:`

  const prompt = PromptTemplate.fromTemplate(template)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  try {
    const title = await chain.invoke({
      question: question.slice(0, 200),
      answer: answer.slice(0, 200)
    })
    return title.trim()
  } catch (error) {
    console.error('Failed to generate title:', error)
    return question.slice(0, 10)
  }
}
