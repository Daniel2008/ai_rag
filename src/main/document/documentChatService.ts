/**
 * 文档生成聊天服务
 * 将文档生成集成到对话流程中，使用流式输出和思维链
 */
import { dialog, BrowserWindow } from 'electron'
import { searchSimilarDocuments } from '../rag/store'
import { generateWordDocument } from './wordGenerator'
import { generatePPTDocument } from './pptGenerator'
import type { DocumentOutline, SectionContent, DocumentTheme } from './types'
import { getSettings, type ModelProvider } from '../settings'
import { ChatOpenAI } from '@langchain/openai'
import { ChatOllama } from '@langchain/ollama'
import { ChatAnthropic } from '@langchain/anthropic'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'

/** 文档生成请求（从聊天中解析） */
export interface DocumentChatRequest {
  type: 'word' | 'ppt'
  title: string
  requirements?: string
  sources?: string[]
  theme?: DocumentTheme
}

/** 检测用户意图是否是生成文档 */
export function detectDocumentIntent(message: string): DocumentChatRequest | null {
  const lowerMsg = message.toLowerCase()

  // 检测 PPT 生成意图
  const pptKeywords = [
    '生成ppt',
    '做ppt',
    '写ppt',
    '制作ppt',
    '创建ppt',
    '演示文稿',
    '幻灯片',
    'powerpoint',
    'ppt文档'
  ]
  const isPPT = pptKeywords.some((kw) => lowerMsg.includes(kw))

  // 检测 Word 生成意图
  const wordKeywords = [
    '生成word',
    '写文档',
    '生成文档',
    '写报告',
    '生成报告',
    '制作报告',
    '创建文档',
    'word文档',
    '写一份'
  ]
  const isWord = wordKeywords.some((kw) => lowerMsg.includes(kw))

  if (!isPPT && !isWord) return null

  // 提取主题（简单实现，移除关键词后的内容作为主题）
  let title = message
  const allKeywords = [
    ...pptKeywords,
    ...wordKeywords,
    '关于',
    '主题',
    '标题',
    '帮我',
    '请',
    '能否',
    '可以'
  ]
  for (const kw of allKeywords) {
    title = title.replace(new RegExp(kw, 'gi'), '')
  }
  title = title.trim()

  // 如果标题为空，使用默认标题
  if (!title || title.length < 2) {
    title = isPPT ? '演示文稿' : '文档报告'
  }

  return {
    type: isPPT ? 'ppt' : 'word',
    title,
    requirements: message,
    theme: 'professional'
  }
}

// 创建 LLM 模型实例
function createChatModel(provider: ModelProvider): BaseChatModel {
  const settings = getSettings()

  switch (provider) {
    case 'ollama': {
      const config = settings.ollama
      return new ChatOllama({
        baseUrl: settings.ollamaUrl || config.baseUrl,
        model: config.chatModel
      })
    }
    case 'openai': {
      const config = settings.openai
      if (!config.apiKey) throw new Error('OpenAI API Key 未设置')
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'anthropic': {
      const config = settings.anthropic
      if (!config.apiKey) throw new Error('Anthropic API Key 未设置')
      return new ChatAnthropic({
        anthropicApiKey: config.apiKey,
        anthropicApiUrl: config.baseUrl,
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'deepseek': {
      const config = settings.deepseek
      if (!config.apiKey) throw new Error('DeepSeek API Key 未设置')
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'zhipu': {
      const config = settings.zhipu
      if (!config.apiKey) throw new Error('智谱 AI API Key 未设置')
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    case 'moonshot': {
      const config = settings.moonshot
      if (!config.apiKey) throw new Error('Moonshot API Key 未设置')
      return new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: { baseURL: config.baseUrl },
        model: config.chatModel
      }) as unknown as BaseChatModel
    }
    default:
      throw new Error(`不支持的模型提供商: ${provider}`)
  }
}

/**
 * 思维链步骤状态（与 Ant Design X ThoughtChain 兼容）
 */
type StepStatus = 'loading' | 'success' | 'error' | 'abort'

/**
 * 生成思维链步骤标记
 */
function stepMark(
  id: string,
  title: string,
  status: StepStatus,
  content?: string,
  icon?: string
): string {
  return `[STEP:${id}:${title}:${status}:${icon || ''}]${content || ''}[/STEP]`
}

/**
 * 流式生成文档（集成到对话中）
 * 返回一个异步生成器，可以流式输出思维过程
 */
export async function* streamDocumentGeneration(
  request: DocumentChatRequest,
  options?: { sources?: string[] }
): AsyncGenerator<string> {
  const { type, title, requirements, theme = 'professional' } = request
  const typeLabel = type === 'word' ? 'Word 文档' : 'PPT 演示文稿'
  const sectionLabel = type === 'word' ? '章节' : '幻灯片'

  try {
    // 开始思维链
    yield '<think>'

    // 步骤1: 分析需求
    yield stepMark(
      'analyze',
      '分析需求',
      'loading',
      `文档类型: ${typeLabel}\n主题: ${title}\n要求: ${requirements || '无特殊要求'}`,
      'FileText'
    )
    yield stepMark(
      'analyze',
      '分析需求',
      'success',
      `文档类型: ${typeLabel} | 主题: ${title}`,
      'FileText'
    )

    // 步骤2: 检索知识库
    yield stepMark('search', '检索知识库', 'loading', '正在搜索相关内容...', 'Search')

    const searchQuery = `${title} ${requirements || ''}`
    const contextDocs = await searchSimilarDocuments(searchQuery, {
      k: 10,
      sources: options?.sources
    })

    // 显示引用的文档
    const fileNames = [
      ...new Set(
        contextDocs.map((d) =>
          d.metadata?.source ? String(d.metadata.source).split(/[\\/]/).pop() : '未知文档'
        )
      )
    ].filter((n) => n !== '未知文档')

    if (contextDocs.length === 0) {
      yield stepMark(
        'search',
        '检索知识库',
        'success',
        '未找到相关内容，将基于通用知识生成',
        'Search'
      )
    } else {
      yield stepMark(
        'search',
        '检索知识库',
        'success',
        `找到 ${contextDocs.length} 个相关片段\n引用: ${fileNames.slice(0, 3).join('、')}${fileNames.length > 3 ? '...' : ''}`,
        'Database'
      )
    }

    const ragContext = contextDocs.map((d) => d.pageContent).join('\n\n')

    // 步骤3: 生成大纲
    yield stepMark('outline', '规划文档大纲', 'loading', '正在智能规划结构...', 'OrderedList')

    const settings = getSettings()
    const model = createChatModel(settings.provider)

    const outlinePrompt = `你是一位专业的文档规划专家。请根据用户需求和参考资料，为${typeLabel}设计一个结构清晰、逻辑严谨的大纲。

用户需求: ${requirements || title}

参考资料:
${ragContext.slice(0, 3000) || '（无参考资料，请基于通用知识规划）'}

要求:
1. 根据主题复杂度和参考资料，自主决定需要多少个${sectionLabel}（通常 4-8 个）
2. 每个${sectionLabel}包含 2-4 个关键要点
3. 结构要有逻辑性，符合文档类型特点
4. 标题和要点要具体，紧密贴合用户需求和参考资料内容

请严格按照以下 JSON 格式返回，不要包含任何其他内容:
{
  "title": "文档标题",
  "subtitle": "副标题（可选，简短描述）",
  "sections": [
    {
      "title": "${sectionLabel}标题",
      "keyPoints": ["要点1", "要点2", "要点3"]
    }
  ]
}

仅返回 JSON，不要 markdown 代码块。`

    const outlineResponse = await model.invoke(outlinePrompt)
    let outlineContent =
      typeof outlineResponse.content === 'string'
        ? outlineResponse.content
        : JSON.stringify(outlineResponse.content)

    // 清理 JSON
    if (outlineContent.includes('```json')) {
      outlineContent = outlineContent.replace(/```json\s*/g, '').replace(/```\s*/g, '')
    } else if (outlineContent.includes('```')) {
      outlineContent = outlineContent.replace(/```\s*/g, '')
    }
    outlineContent = outlineContent.trim()

    let outline: DocumentOutline
    try {
      outline = JSON.parse(outlineContent)
      if (!outline.title) outline.title = title
      outline.sections = outline.sections?.map((s) => ({ ...s, level: 1 })) || []
    } catch {
      // 解析失败，让模型用更简单的方式重试
      const simplePrompt = `为"${title}"生成 5 个章节标题。只返回JSON：{"title":"${title}","sections":[{"title":"章节1"},{"title":"章节2"}]}`
      const retryResponse = await model.invoke(simplePrompt)
      let retryContent =
        typeof retryResponse.content === 'string'
          ? retryResponse.content
          : JSON.stringify(retryResponse.content)

      if (retryContent.includes('```')) {
        retryContent = retryContent.replace(/```\w*\n?/g, '').replace(/```/g, '')
      }

      try {
        const parsed = JSON.parse(retryContent.trim())
        outline = {
          title: parsed.title || title,
          subtitle: requirements?.slice(0, 50),
          sections: (parsed.sections || []).map((s: { title: string }) => ({
            title: s.title,
            level: 1,
            keyPoints: []
          }))
        }
      } catch {
        // 最终兜底
        outline = {
          title,
          subtitle: requirements?.slice(0, 50),
          sections: [
            { title: `${title}概述`, level: 1, keyPoints: [] },
            { title: `${title}分析`, level: 1, keyPoints: [] },
            { title: `${title}方案`, level: 1, keyPoints: [] },
            { title: `${title}总结`, level: 1, keyPoints: [] }
          ]
        }
      }
    }

    // 大纲生成完成，显示结构
    const outlineSummary = outline.sections.map((s, i) => `${i + 1}. ${s.title}`).join('\n')
    yield stepMark(
      'outline',
      '规划文档大纲',
      'success',
      `${outline.title}\n${outlineSummary}`,
      'OrderedList'
    )

    // 步骤4: 生成各章节内容
    const contents: SectionContent[] = []
    const totalSections = outline.sections.length

    for (let i = 0; i < outline.sections.length; i++) {
      const section = outline.sections[i]
      const stepId = `content_${i}`

      // 显示当前章节正在生成
      yield stepMark(
        stepId,
        `撰写: ${section.title}`,
        'loading',
        `[${i + 1}/${totalSections}] 正在生成内容...`,
        'Edit'
      )

      // 为每个章节检索更精确的内容
      const sectionDocs = await searchSimilarDocuments(section.title, {
        k: 5,
        sources: options?.sources
      })
      const sectionContext = sectionDocs.map((d) => d.pageContent).join('\n\n') || ragContext

      const contentPrompt = `请为${typeLabel}的「${section.title}」${sectionLabel}撰写内容。

关键要点: ${section.keyPoints?.join('、') || '根据标题自行确定'}

参考资料:
${sectionContext.slice(0, 2000)}

要求:
1. 写 2-3 段内容，每段 ${type === 'word' ? '100-200' : '50-100'} 字
2. 提取 3-5 个核心要点作为列表
3. 内容要专业、具体、有价值

请严格按照 JSON 格式返回:
{
  "paragraphs": ["第一段...", "第二段..."],
  "bulletPoints": ["要点1", "要点2", "要点3"]
}

仅返回 JSON。`

      const contentResponse = await model.invoke(contentPrompt)
      let contentText =
        typeof contentResponse.content === 'string'
          ? contentResponse.content
          : JSON.stringify(contentResponse.content)

      // 清理 JSON
      if (contentText.includes('```')) {
        contentText = contentText.replace(/```json\s*/g, '').replace(/```\s*/g, '')
      }
      contentText = contentText.trim()

      try {
        const parsed = JSON.parse(contentText)
        const paragraphs = parsed.paragraphs || []
        const bulletPoints = parsed.bulletPoints || section.keyPoints || []

        contents.push({
          title: section.title,
          paragraphs,
          bulletPoints,
          sources: sectionDocs
            .slice(0, 2)
            .map((d) =>
              d.metadata?.source ? String(d.metadata.source).split(/[\\/]/).pop() || '' : ''
            )
            .filter(Boolean)
        })

        // 章节完成，显示内容预览
        const preview = paragraphs[0]
          ? paragraphs[0].slice(0, 80) + (paragraphs[0].length > 80 ? '...' : '')
          : ''
        const pointsPreview =
          bulletPoints.length > 0 ? `\n要点: ${bulletPoints.slice(0, 2).join('、')}...` : ''
        yield stepMark(
          stepId,
          `撰写: ${section.title}`,
          'success',
          `${preview}${pointsPreview}`,
          'Check'
        )
      } catch {
        // 内容解析失败，让模型直接生成文本
        const plainPrompt = `为"${section.title}"写一段 100 字左右的介绍。`
        const plainResponse = await model.invoke(plainPrompt)
        const plainText =
          typeof plainResponse.content === 'string'
            ? plainResponse.content
            : String(plainResponse.content)

        contents.push({
          title: section.title,
          paragraphs: [plainText.trim()],
          bulletPoints: section.keyPoints || [],
          sources: []
        })

        // 显示生成的内容预览
        const preview = plainText.trim().slice(0, 80) + (plainText.length > 80 ? '...' : '')
        yield stepMark(stepId, `撰写: ${section.title}`, 'success', preview, 'Check')
      }
    }

    // 步骤5: 生成文档文件
    yield stepMark('generate', `生成${typeLabel}`, 'loading', '正在生成文件...', 'File')
    yield '</think>'

    // 弹出保存对话框
    const extension = type === 'word' ? 'docx' : 'pptx'
    const defaultFileName = `${outline.title}.${extension}`

    console.log('[DocumentChat] Opening save dialog...')

    // 获取主窗口
    const windows = BrowserWindow.getAllWindows()
    const mainWindow = windows[0]

    if (!mainWindow) {
      yield `\n❌ 无法打开保存对话框，请稍后重试。`
      return
    }

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, {
      title: `保存${typeLabel}`,
      defaultPath: defaultFileName,
      filters: [
        type === 'word'
          ? { name: 'Word文档', extensions: ['docx'] }
          : { name: 'PowerPoint演示文稿', extensions: ['pptx'] }
      ]
    })

    console.log('[DocumentChat] Save dialog result:', { filePath, canceled })

    if (canceled || !filePath) {
      yield `\n⚠️ 您取消了保存。如需重新生成，请再次告诉我。`
      return
    }

    // 生成文件
    console.log('[DocumentChat] Generating document to:', filePath)
    try {
      if (type === 'word') {
        await generateWordDocument(outline, contents, filePath, theme)
      } else {
        await generatePPTDocument(outline, contents, filePath, theme)
      }
      console.log('[DocumentChat] Document generated successfully')
    } catch (genError) {
      console.error('[DocumentChat] Document generation error:', genError)
      // 在 think 标签外显示错误
      yield '<think>'
      yield stepMark('generate', `生成${typeLabel}`, 'error', '文件生成失败', 'File')
      yield '</think>'
      yield `\n❌ **文件生成失败**: ${genError instanceof Error ? genError.message : '未知错误'}`
      return
    }

    // 成功完成
    yield '<think>'
    yield stepMark(
      'generate',
      `生成${typeLabel}`,
      'success',
      `已保存: ${filePath.split(/[\\/]/).pop()}`,
      'Check'
    )
    yield '</think>'

    yield `\n🎉 **${typeLabel}已成功生成！**\n\n`
    yield `📁 **保存位置:** \`${filePath}\`\n\n`
    yield `📊 **文档概要:**\n`
    yield `- 包含 ${outline.sections.length} 个${sectionLabel}\n`
    yield `- 基于 ${contextDocs.length} 个知识库片段生成\n\n`
    yield `如需修改或重新生成，请告诉我具体要求。`
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : '未知错误'
    console.error('[DocumentChat] Error:', error)
    yield '<think>'
    yield stepMark('error', '生成失败', 'error', errorMsg, 'File')
    yield '</think>'
    yield `\n❌ **生成失败**: ${errorMsg}\n\n请检查设置或稍后重试。`
  }
}

/**
 * 检查消息是否包含文档生成意图，如果是则返回生成器
 */
export function handleDocumentGenerationIfNeeded(
  message: string,
  sources?: string[]
): AsyncGenerator<string> | null {
  const intent = detectDocumentIntent(message)
  if (!intent) return null

  intent.sources = sources
  return streamDocumentGeneration(intent, { sources })
}
