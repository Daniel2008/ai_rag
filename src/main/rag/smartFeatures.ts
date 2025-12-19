import { Document } from '@langchain/core/documents'
import { createChatModel } from '../utils/createChatModel'
import { getSettings } from '../settings'
import { logInfo, logWarn, logDebug } from '../utils/logger'
import { searchSimilarDocuments } from './store/index'

export interface SmartPromptOptions {
  /** 智能提示数量 */
  count?: number
  /** 基于文档内容生成 */
  basedOn?: 'recent' | 'all' | 'collection'
  /** 目标长度 */
  length?: 'short' | 'medium' | 'long'
  /** 语气风格 */
  tone?: 'professional' | 'casual' | 'academic'
}

export interface AutoSummaryOptions {
  /** 摘要长度 */
  length?: 'short' | 'medium' | 'long'
  /** 保留的关键点数量 */
  keyPoints?: number
  /** 语言 */
  language?: 'zh' | 'en' | 'auto'
  /** 格式 */
  format?: 'paragraph' | 'bullet' | 'outline'
}

export interface ContentAnalysis {
  topic: string
  keywords: string[]
  entities: string[]
  sentiment: 'positive' | 'neutral' | 'negative'
  complexity: number
  suggestedQuestions: string[]
}

/**
 * 智能提示生成器
 */
export class SmartPromptGenerator {
  private model: unknown

  constructor() {
    const settings = getSettings()
    this.model = createChatModel(settings.provider)
  }

  /**
   * 生成智能提示问题
   */
  async generatePrompts(
    context: string,
    options: SmartPromptOptions = {}
  ): Promise<string[]> {
    const {
      count = 3,
      length = 'medium',
      tone = 'professional'
    } = options

    try {
      const prompt = this.buildPromptGenerationPrompt(context, count, length, tone)
      
      logDebug('生成智能提示', 'SmartPrompt', {
        contextLength: context.length,
        options
      })

      const result = await (this.model as { invoke: (input: unknown) => Promise<unknown> }).invoke(prompt)
      const resultContent =
        typeof result === 'string'
          ? result
          : typeof (result as { content?: unknown })?.content === 'string'
            ? String((result as { content?: unknown }).content)
            : String(result)
      const prompts = this.parsePrompts(resultContent)

      logInfo('智能提示生成完成', 'SmartPrompt', {
        count: prompts.length,
        prompts: prompts.slice(0, 2)
      })

      return prompts.slice(0, count)

    } catch (error) {
      logWarn('智能提示生成失败', 'SmartPrompt', {}, error as Error)
      
      // 降级：返回通用提示
      return this.generateFallbackPrompts(count, length)
    }
  }

  /**
   * 生成基于文档的智能提示
   */
  async generatePromptsFromDocuments(
    documents: Document[],
    options: SmartPromptOptions = {}
  ): Promise<string[]> {
    if (documents.length === 0) {
      return this.generateFallbackPrompts(options.count || 3, options.length || 'medium')
    }

    // 提取文本内容
    const content = documents.map(d => d.pageContent).join('\n\n')
    
    // 生成基于内容的提示
    const prompts = await this.generatePrompts(content, options)
    
    // 如果有文档元数据，进一步优化提示
    const metadataPrompts = this.enrichWithMetadata(prompts, documents)
    
    return metadataPrompts
  }

  /**
   * 生成文档自动摘要
   */
  async generateSummary(
    content: string,
    options: AutoSummaryOptions = {}
  ): Promise<{
    summary: string
    keyPoints: string[]
    tags: string[]
  }> {
    const {
      length = 'medium',
      keyPoints = 5,
      language = 'auto',
      format = 'paragraph'
    } = options

    try {
      const prompt = this.buildSummaryPrompt(content, length, keyPoints, language, format)
      
      logDebug('生成自动摘要', 'SmartPrompt', {
        contentLength: content.length,
        options
      })

      const result = await (this.model as { invoke: (input: unknown) => Promise<unknown> }).invoke(prompt)
      const resultContent =
        typeof result === 'string'
          ? result
          : typeof (result as { content?: unknown })?.content === 'string'
            ? String((result as { content?: unknown }).content)
            : String(result)
      const parsed = this.parseSummary(resultContent)

      logInfo('自动摘要生成完成', 'SmartPrompt', {
        summaryLength: parsed.summary.length,
        keyPointsCount: parsed.keyPoints.length
      })

      return parsed

    } catch (error) {
      logWarn('自动摘要生成失败', 'SmartPrompt', {}, error as Error)
      
      // 降级：简单摘要
      return this.generateFallbackSummary(content, length)
    }
  }

  /**
   * 分析文档内容
   */
  async analyzeContent(content: string): Promise<ContentAnalysis> {
    try {
      const prompt = this.buildAnalysisPrompt(content)
      
      logDebug('分析文档内容', 'SmartPrompt', {
        contentLength: content.length
      })

      const result = await (this.model as { invoke: (input: unknown) => Promise<unknown> }).invoke(prompt)
      const resultContent =
        typeof result === 'string'
          ? result
          : typeof (result as { content?: unknown })?.content === 'string'
            ? String((result as { content?: unknown }).content)
            : String(result)
      const analysis = this.parseAnalysis(resultContent)

      logInfo('内容分析完成', 'SmartPrompt', {
        topic: analysis.topic,
        keywordCount: analysis.keywords.length
      })

      return analysis

    } catch (error) {
      logWarn('内容分析失败', 'SmartPrompt', {}, error as Error)
      
      // 降级：简单分析
      return this.fallbackAnalysis(content)
    }
  }

  /**
   * 生成基于知识库的智能提示
   */
  async generateKnowledgeBasedPrompts(
    query: string,
    options: SmartPromptOptions = {}
  ): Promise<string[]> {
    // 检索相关文档
    const relatedDocs = await searchSimilarDocuments(query, { k: 3 })
    
    if (relatedDocs.length === 0) {
      return this.generateFallbackPrompts(options.count || 3, options.length || 'medium')
    }

    // 提取相关内容
    const relatedContent = relatedDocs.map(d => d.pageContent).join('\n\n')
    
    // 生成基于检索结果的提示
    const fullContext = `相关文档内容：\n${relatedContent}\n\n用户查询：${query}`
    
    return this.generatePrompts(fullContext, options)
  }

  // 私有辅助方法

  private buildPromptGenerationPrompt(
    context: string,
    count: number,
    length: string,
    tone: string
  ): string {
    const lengthMap = {
      short: '简短的问题（10-20字）',
      medium: '中等长度的问题（20-40字）',
      long: '详细的问题（40-80字）'
    }

    const toneMap = {
      professional: '专业、正式的语气',
      casual: '自然、友好的语气',
      academic: '学术、严谨的语气'
    }

    return `你是一个智能助手，需要基于以下内容生成 ${count} 个相关的提示问题。

内容背景：
${context}

要求：
1. 问题应该基于内容，具有相关性和实用性
2. 问题类型可以是：事实性、探索性、应用性
3. 问题应该易懂且自然
4. 使用 ${toneMap[tone]} 
5. 每个问题 ${lengthMap[length]}

输出格式（每行一个问题）：
1. [问题内容]
2. [问题内容]
... 

生成 ${count} 个问题：`
  }

  private buildSummaryPrompt(
    content: string,
    length: string,
    keyPoints: number,
    language: string,
    format: string
  ): string {
    const lengthMap = {
      short: '100-200字',
      medium: '300-500字',
      long: '500-800字'
    }

    const langInstruction = language === 'auto' ? '使用中文' : 
                           language === 'zh' ? '使用中文' : '使用英文'

    const formatInstruction = format === 'bullet' ? '使用项目符号列表' :
                             format === 'outline' ? '使用大纲格式' : '使用段落格式'

    return `请为以下内容生成一个${lengthMap[length]}的摘要，并提取 ${keyPoints} 个关键点。

内容：
${content}

要求：
1. ${langInstruction}
2. ${formatInstruction}
3. 摘要要简洁明了，突出核心内容
4. 关键点要具体且有价值

输出格式：
摘要：[摘要内容]

关键点：
1. [关键点1]
2. [关键点2]
...`

  }

  private buildAnalysisPrompt(content: string): string {
    return `请分析以下内容，并提供详细分析：

内容：
${content}

要求：
1. 识别主题和核心概念
2. 提取关键词（5-10个）
3. 识别实体（人名、地名、组织等）
4. 分析情感倾向（积极/中性/消极）
5. 评估内容复杂度（1-10分）
6. 提出3-5个相关问题建议

输出格式（JSON）：
{
  "topic": "主题",
  "keywords": ["关键词1", "关键词2", ...],
  "entities": ["实体1", "实体2", ...],
  "sentiment": "positive/neutral/negative",
  "complexity": 数字,
  "suggestedQuestions": ["问题1", "问题2", ...]
}`
  }

  private parsePrompts(content: string): string[] {
    const lines = content.split('\n')
    const prompts: string[] = []

    for (const line of lines) {
      const trimmed = line.trim()
      // 匹配 "1. " 或 "1. " 等格式
      const match = trimmed.match(/^\d+[.)]\s*(.*)/)
      if (match) {
        const prompt = match[1].trim()
        if (prompt && prompt.length > 0) {
          prompts.push(prompt)
        }
      } else if (trimmed.length > 0 && !trimmed.startsWith('#') && !trimmed.startsWith('生成')) {
        // 如果没有编号，直接作为候选
        prompts.push(trimmed)
      }
    }

    return prompts
  }

  private parseSummary(content: string): {
    summary: string
    keyPoints: string[]
    tags: string[]
  } {
    let summary = ''
    const keyPoints: string[] = []
    let tags: string[] = []

    // 提取摘要部分
    const summaryMatch = content.match(/摘要[：:]\s*([\s\S]*?)(?=\n\n关键点|$)/i)
    if (summaryMatch) {
      summary = summaryMatch[1].trim()
    }

    // 提取关键点
    const keyPointsMatch = content.match(/关键点[：:][\s\S]*?(?=\n|$)/i)
    if (keyPointsMatch) {
      const lines = keyPointsMatch[0].split('\n')
      for (const line of lines) {
        const match = line.match(/^\d+[.)]\s*(.*)/)
        if (match) {
          keyPoints.push(match[1].trim())
        }
      }
    }

    // 提取标签（基于关键词）
    const keywords = summary.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,10}/g) || []
    tags = [...new Set(keywords)].slice(0, 5)

    return { summary, keyPoints, tags }
  }

  private parseAnalysis(content: string): ContentAnalysis {
    try {
      // 尝试解析JSON格式
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0])
        return {
          topic: data.topic || '未知主题',
          keywords: data.keywords || [],
          entities: data.entities || [],
          sentiment: data.sentiment || 'neutral',
          complexity: data.complexity || 5,
          suggestedQuestions: data.suggestedQuestions || []
        }
      }
    } catch {
      // JSON解析失败，使用文本解析
    }

    // 文本解析
    return this.fallbackAnalysis(content)
  }

  private fallbackAnalysis(content: string): ContentAnalysis {
    // 简单的关键词提取
    const words = content.toLowerCase().match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,10}/g) || []
    const wordFreq: Record<string, number> = {}
    words.forEach(w => {
      wordFreq[w] = (wordFreq[w] || 0) + 1
    })
    const keywords = Object.entries(wordFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([w]) => w)

    // 简单实体提取（大写字母开头的）
    const entities = content.match(/[A-Z][a-zA-Z]+/g) || []

    // 简单复杂度评估
    const complexity = Math.min(10, Math.max(1, Math.floor(content.length / 100)))

    return {
      topic: keywords.slice(0, 2).join('、') || '未知主题',
      keywords,
      entities,
      sentiment: 'neutral',
      complexity,
      suggestedQuestions: keywords.slice(0, 3).map(k => `关于${k}有什么信息？`)
    }
  }

  private generateFallbackPrompts(count: number, length: string | undefined): string[] {
    const templates = {
      short: [
        '请详细说明这个主题',
        '有什么相关建议吗？',
        '如何应用这个概念？',
        '需要注意什么？',
        '有什么最佳实践？'
      ],
      medium: [
        '请详细解释这个概念，包括背景和应用场景',
        '这个主题有哪些关键点需要考虑？',
        '如何在实际工作中应用这些知识？',
        '有什么常见的误区需要避免？',
        '能否提供一些具体的例子？'
      ],
      long: [
        '请全面分析这个主题，包括理论基础、实际应用和未来趋势',
        '这个领域有哪些重要的研究方向和进展？',
        '在实际项目中应用这些知识时会遇到什么挑战？如何解决？',
        '能否提供详细的案例分析和最佳实践总结？',
        '这个主题与相关领域有什么联系和区别？'
      ]
    }

    const pool = templates[length as keyof typeof templates] || templates.medium
    return pool.slice(0, count)
  }

  private generateFallbackSummary(content: string, length: string | undefined): {
    summary: string
    keyPoints: string[]
    tags: string[]
  } {
    // 简单截取作为摘要
    const maxLength = length === 'short' ? 200 : length === 'long' ? 800 : 500
    const summary = content.length > maxLength ? content.substring(0, maxLength) + '...' : content
    const sentences = content.split(/[。！？.!?]/).filter(s => s.trim().length > 0)
    const keyPoints = sentences.slice(0, 3)
    const words = content.match(/[\u4e00-\u9fa5]{2,4}|[a-zA-Z]{3,10}/g) || []
    const tags = [...new Set(words)].slice(0, 5)

    return { summary, keyPoints, tags }
  }

  private enrichWithMetadata(prompts: string[], documents: Document[]): string[] {
    // 基于文档元数据增强提示
    const sources = new Set<string>()
    const tags = new Set<string>()

    documents.forEach(doc => {
      if (doc.metadata?.source) {
        sources.add(doc.metadata.source)
      }
      if (doc.metadata?.tags) {
        doc.metadata.tags.forEach((tag: string) => tags.add(tag))
      }
    })

    if (sources.size === 0 && tags.size === 0) {
      return prompts
    }

    const metadataContext = [
      sources.size > 0 ? `相关文档：${Array.from(sources).slice(0, 3).join(', ')}` : '',
      tags.size > 0 ? `相关标签：${Array.from(tags).slice(0, 5).join(', ')}` : ''
    ].filter(Boolean).join('；')

    return prompts.map(prompt => 
      metadataContext ? `${prompt} （${metadataContext}）` : prompt
    )
  }
}

/**
 * 便捷函数：生成智能提示
 */
export async function generateSmartPrompts(
  context: string,
  options?: SmartPromptOptions
): Promise<string[]> {
  const generator = new SmartPromptGenerator()
  return generator.generatePrompts(context, options)
}

/**
 * 便捷函数：生成自动摘要
 */
export async function generateAutoSummary(
  content: string,
  options?: AutoSummaryOptions
): ReturnType<SmartPromptGenerator['generateSummary']> {
  const generator = new SmartPromptGenerator()
  return generator.generateSummary(content, options)
}

/**
 * 便捷函数：分析内容
 */
export async function analyzeContent(
  content: string
): Promise<ContentAnalysis> {
  const generator = new SmartPromptGenerator()
  return generator.analyzeContent(content)
}

/**
 * 便捷函数：基于知识库生成提示
 */
export async function generateKnowledgePrompts(
  query: string,
  options?: SmartPromptOptions
): Promise<string[]> {
  const generator = new SmartPromptGenerator()
  return generator.generateKnowledgeBasedPrompts(query, options)
}

/**
 * 智能问答助手类
 */
export class SmartQnAAssistant {
  private generator: SmartPromptGenerator

  constructor() {
    this.generator = new SmartPromptGenerator()
  }

  /**
   * 生成问题的答案
   */
  async answerQuestion(
    question: string,
    context: string
  ): Promise<{
    answer: string
    sources: string[]
    relatedQuestions: string[]
  }> {
    const prompt = `基于以下上下文信息，回答用户的问题。

上下文：
${context}

问题：
${question}

要求：
1. 基于上下文信息给出准确的回答
2. 回答要简洁明了，重点突出
3. 如果上下文中没有足够信息，请说明
4. 回答完成后，提供3个相关的后续问题

输出格式：
[回答内容]

相关问题：
1. [问题1]
2. [问题2]
3. [问题3]`

    try {
      const settings = getSettings()
      const model = createChatModel(settings.provider)
      const result = await model.invoke(prompt)
      // 确保content是字符串
      let content: string
      if (typeof result === 'string') {
        content = result
      } else if (result.content) {
        content = typeof result.content === 'string' ? result.content : String(result.content)
      } else {
        content = String(result)
      }
      
      // 解析回答和相关问题
      const parts = content.split(/相关问题：/i)
      const answer = parts[0].trim()
      const relatedQuestions = parts[1] ? this.generator['parsePrompts'](parts[1]) : []

      logInfo('智能问答完成', 'SmartQnA', {
        questionLength: question.length,
        answerLength: answer.length,
        relatedCount: relatedQuestions.length
      })

      return {
        answer,
        sources: [], // 可以通过RAG检索获取
        relatedQuestions
      }

    } catch (error) {
      logWarn('智能问答失败', 'SmartQnA', {}, error as Error)
      
      // 降级回答
      return {
        answer: '抱歉，我无法基于当前上下文回答这个问题。请尝试提供更具体的问题或补充相关文档。',
        sources: [],
        relatedQuestions: []
      }
    }
  }

  /**
   * 生成文档学习总结
   */
  async generateLearningSummary(
    documents: Document[]
  ): Promise<{
    summary: string
    learningPoints: string[]
    studyQuestions: string[]
  }> {
    const content = documents.map(d => d.pageContent).join('\n\n')
    
    const analysis = await this.generator.analyzeContent(content)
    const summary = await this.generator.generateSummary(content, {
      length: 'medium',
      keyPoints: 5,
      format: 'bullet'
    })

    // 生成学习问题
    const studyQuestions = analysis.suggestedQuestions.slice(0, 3)

    return {
      summary: summary.summary,
      learningPoints: summary.keyPoints,
      studyQuestions
    }
  }
}
