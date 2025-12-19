import { StringOutputParser } from '@langchain/core/output_parsers'
import { PromptTemplate } from '@langchain/core/prompts'
import {
  searchSimilarDocumentsWithScores,
  getDocCount,
  withEmbeddingProgressSuppressed
} from './store/index'
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

export interface RagContextBuildResult {
  context: string
  sources: ChatSource[]
  isGlobalSearch: boolean
  emptyIndexMessage?: string
  metrics: {
    searchLimit: number
    retrievedCount: number
    effectiveCount: number
    uniqueSourceCount: number
    topScore?: number
    thresholdUsed?: number
    usedFallback: boolean
    durationMs: number
  }
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

/** 去重：相同文件+页码+内容片段只保留一个，允许同文件多条不同内容 */
function deduplicateSources(sources: ChatSource[]): ChatSource[] {
  const seen = new Map<string, ChatSource>()

  for (const source of sources) {
    // 使用文件名+页码+内容前50字符作为主键，允许同文件同页的不同内容片段
    const contentKey = source.content?.slice(0, 50) || ''
    const key = `${source.fileName}:${source.pageNumber || 0}:${contentKey}`
    const existing = seen.get(key)

    // 保留分数更高的（仅对完全相同的内容去重）
    if (!existing || (source.score || 0) > (existing.score || 0)) {
      seen.set(key, { ...source })
    }
  }

  // 按分数降序排序
  return Array.from(seen.values()).sort((a, b) => (b.score || 0) - (a.score || 0))
}

/** 按分数排序返回结果，不再限制每个来源的数量 */
function ensureSourceDiversity(
  pairs: { doc: Document; score: number }[],
  _minSources: number = 3,
  _maxPerSource: number = 20
): { doc: Document; score: number }[] {
  if (pairs.length === 0) return pairs

  // 直接按分数降序排序返回所有结果，不限制每个来源的数量
  return [...pairs].sort((a, b) => b.score - a.score)
}

/** 将检索到的文档转换为来源信息 */
function convertDocsToSources(docs: Document[], scores: number[]): ChatSource[] {
  return docs.map((doc, index) => {
    const metadata = doc.metadata || {}
    const filePath = typeof metadata.source === 'string' ? metadata.source : undefined
    const isUrl = filePath ? isUrlPath(filePath) : false
    const fileName = extractFileName(filePath || '', metadata.title || metadata.fileName)

    const rawPageNumber =
      typeof metadata.pageNumber === 'number'
        ? metadata.pageNumber
        : typeof metadata.loc?.pageNumber === 'number'
          ? metadata.loc.pageNumber
          : undefined

    const fileType = metadata.fileType || metadata.type || (isUrl ? 'url' : inferFileType(fileName))
    const score = scores[index] ?? 1 - index * 0.15

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

function asAsyncGenerator(stream: AsyncIterable<string>): AsyncGenerator<string> {
  return (async function* () {
    for await (const chunk of stream) {
      yield chunk
    }
  })()
}

export async function streamAnswer(
  question: string,
  context: string,
  isGlobalSearch: boolean,
  memory?: string
): Promise<AsyncGenerator<string>> {
  const settings = getSettings()
  const memoryBlock = memory?.trim()
    ? `会话记忆（可能有用，若与检索冲突以检索为准）：\n${memory.trim()}\n\n`
    : ''
  const fullContext = memoryBlock + context
  const promptText = buildPrompt(fullContext, question, isGlobalSearch)

  if (settings.provider === 'deepseek' && settings.deepseek.chatModel.includes('reasoner')) {
    logInfo('Using DeepSeek Reasoner', 'Chat')
    const config = settings.deepseek
    if (!config.apiKey) {
      throw new Error('DeepSeek API Key 未设置，请在设置中配置')
    }
    return streamDeepSeekReasoner(
      config.apiKey,
      config.baseUrl || 'https://api.deepseek.com',
      config.chatModel,
      promptText
    )
  }

  const template = buildPrompt('{context}', '{question}', isGlobalSearch)

  const prompt = PromptTemplate.fromTemplate(template)
  const model = createChatModel(settings.provider)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])

  const stream = await chain.stream({ context: fullContext, question })
  return asAsyncGenerator(stream)
}

export async function updateConversationMemory(
  prevMemory: string | null,
  question: string,
  answer: string
): Promise<string> {
  const settings = getSettings()
  const model = createChatModel(settings.provider)
  const template = `你是对话记忆压缩器。将已有会话记忆与本轮对话融合为新的会话记忆。
要求：
1) 只保留：用户目标/偏好、已确认事实、重要约束、关键结论/决定、待办事项。
2) 删除无关细节、客套话、重复内容。
3) 输出中文，尽量精炼，不超过200字。
4) 只输出记忆文本，不要加标题、列表符号或其它说明。

已有会话记忆：
{memory}

本轮用户问题：
{question}

本轮助手回答：
{answer}

新的会话记忆：`

  const prompt = PromptTemplate.fromTemplate(template)
  const chain = RunnableSequence.from([prompt, model, new StringOutputParser()])
  const next = await chain.invoke({
    memory: (prevMemory || '').slice(0, 800),
    question: question.slice(0, 800),
    answer: answer.slice(0, 1200)
  })
  return next.trim().slice(0, 400)
}

export async function buildRagContext(
  question: string,
  options: ChatOptions = {}
): Promise<RagContextBuildResult> {
  const startTime = Date.now()
  const settings = getSettings()
  const isGlobalSearch = !options.sources || options.sources.length === 0

  logDebug('Starting RAG context build', 'Chat', {
    question: question.slice(0, 50),
    sourcesCount: options.sources?.length ?? 0
  })

  const searchLimit = settings.rag?.searchLimit ?? RAG_CONFIG.SEARCH.DEFAULT_K

  let retrievedPairs: { doc: Document; score: number }[] = []
  try {
    const useHybrid =
      /[a-zA-Z0-9]/.test(question) || question.includes(' ') || question.length >= 20
    if (useHybrid && isGlobalSearch) {
      const { HybridSearcher } = await import('./hybridSearch')
      const searcher = new HybridSearcher({ topK: searchLimit })
      const ctx = await searcher.search(question, { sources: options.sources, limit: searchLimit })
      const hybrid = ctx.hybridResults ?? []
      retrievedPairs = hybrid.map((r) => ({ doc: r.doc, score: r.finalScore }))
    } else {
      retrievedPairs = await withEmbeddingProgressSuppressed(() =>
        searchSimilarDocumentsWithScores(question, {
          k: searchLimit,
          sources: options.sources
        })
      )
    }
  } catch (e) {
    logWarn('Hybrid search failed, fallback to vector search', 'Chat', undefined, e as Error)
    retrievedPairs = await withEmbeddingProgressSuppressed(() =>
      searchSimilarDocumentsWithScores(question, {
        k: searchLimit,
        sources: options.sources
      })
    )
  }

  logDebug('Retrieved documents', 'Chat', {
    count: retrievedPairs.length,
    topScore: retrievedPairs[0]?.score.toFixed(3)
  })

  const uniqueSourcCount = new Set(retrievedPairs.map((p) => p.doc.metadata?.source)).size
  logDebug('Source diversity', 'Chat', { uniqueSources: uniqueSourcCount })

  if (retrievedPairs.length === 0) {
    const docCount = await getDocCount()
    if (docCount === 0) {
      const msg =
        '知识库索引为空或已丢失。如果您刚刚切换了嵌入模型，请等待后台索引重建完成；否则请在侧边栏中点击"重建索引"。'
      return {
        context: '',
        sources: [],
        isGlobalSearch,
        emptyIndexMessage: msg,
        metrics: {
          searchLimit,
          retrievedCount: 0,
          effectiveCount: 0,
          uniqueSourceCount: 0,
          usedFallback: false,
          durationMs: Date.now() - startTime
        }
      }
    }
  }

  const RELEVANCE_THRESHOLD = settings.rag?.minRelevance ?? RAG_CONFIG.SEARCH.RELEVANCE_THRESHOLD
  const RELEVANCE_THRESHOLD_LOW = Math.max(0.1, RELEVANCE_THRESHOLD - 0.15)
  let effectivePairs = retrievedPairs
  let effectiveThreshold: number | undefined

  if (retrievedPairs.length > 0) {
    const topScore = retrievedPairs[0]?.score ?? 0
    const topSource = retrievedPairs[0]?.doc.metadata?.source || ''
    const queryKeywords = question.match(/[\u4e00-\u9fa5]{2,4}/g) || []
    const fileNameMatchesQuery = queryKeywords.some((kw) =>
      topSource.toLowerCase().includes(kw.toLowerCase())
    )

    if (fileNameMatchesQuery) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW
    } else if (topScore >= RELEVANCE_THRESHOLD) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW
    } else if (topScore >= RELEVANCE_THRESHOLD_LOW) {
      effectiveThreshold = RELEVANCE_THRESHOLD_LOW
    } else {
      effectiveThreshold = 0
    }

    effectivePairs = retrievedPairs.filter((p) => {
      if (p.score >= (effectiveThreshold || 0)) return true
      const source = p.doc.metadata?.source || ''
      return queryKeywords.some((kw) => source.toLowerCase().includes(kw.toLowerCase()))
    })

    logDebug('Filtered by relevance threshold', 'Chat', {
      before: retrievedPairs.length,
      after: effectivePairs.length,
      threshold: effectiveThreshold,
      topScore: topScore.toFixed(3),
      fileNameMatch: fileNameMatchesQuery
    })
  }

  let usedFallback = false
  if (effectivePairs.length === 0 && options.sources && options.sources.length > 0) {
    usedFallback = true
    effectivePairs = await loadFallbackContext(options.sources)
  }

  const diversePairs = ensureSourceDiversity(effectivePairs)
  const effectiveDocs = diversePairs.map((p) => p.doc)
  const effectiveScores = diversePairs.map((p) => p.score)
  const context = effectiveDocs.map((doc) => doc.pageContent).join('\n\n')

  const sources = convertDocsToSources(effectiveDocs, effectiveScores)
  const uniqueSources = deduplicateSources(sources)

  logDebug('Final sources', 'Chat', {
    sourceCount: uniqueSources.length,
    fileNames: uniqueSources.map((s) => s.fileName).join(', ')
  })

  logDebug('Context built', 'Chat', { docCount: effectiveDocs.length })

  return {
    context,
    sources: uniqueSources,
    isGlobalSearch,
    metrics: {
      searchLimit,
      retrievedCount: retrievedPairs.length,
      effectiveCount: effectiveDocs.length,
      uniqueSourceCount: uniqueSources.length,
      topScore: retrievedPairs[0]?.score,
      thresholdUsed: effectiveThreshold,
      usedFallback,
      durationMs: Date.now() - startTime
    }
  }
}

// ==================== 主要导出函数 ====================

export async function chatWithRag(
  question: string,
  options: ChatOptions = {}
): Promise<ChatResult> {
  const built = await buildRagContext(question, options)
  if (built.emptyIndexMessage) {
    return {
      stream: (async function* () {
        yield built.emptyIndexMessage!
      })(),
      sources: []
    }
  }

  const stream = await streamAnswer(question, built.context, built.isGlobalSearch)
  return { stream, sources: built.sources }
}

/** 加载兜底上下文（当检索失败时） */
async function loadFallbackContext(sources: string[]): Promise<{ doc: Document; score: number }[]> {
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
