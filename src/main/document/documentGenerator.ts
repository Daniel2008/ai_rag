/**
 * 文档生成服务
 * 整合 LLM 大纲生成、RAG 内容检索和文档生成
 */
import { BrowserWindow, dialog } from 'electron'
import { searchSimilarDocuments } from '../rag/store/index'
import { generateWordDocument } from './wordGenerator'
import { generatePPTDocument } from './pptGenerator'
import type {
  DocumentGenerateRequest,
  DocumentOutline,
  SectionContent,
  DocumentProgress,
  DocumentGenerateResult
} from './types'

// LLM 聊天函数类型
type ChatFunction = (
  question: string,
  sources?: string[]
) => Promise<{ content: string; sources: { content: string; fileName: string }[] }>

// 缓存的 LLM 聊天函数
let cachedChatFunction: ChatFunction | null = null

/**
 * 设置 LLM 聊天函数
 */
export function setLLMChatFunction(chatFn: ChatFunction): void {
  cachedChatFunction = chatFn
}

/**
 * 发送进度更新到渲染进程
 */
function sendProgress(progress: DocumentProgress): void {
  const windows = BrowserWindow.getAllWindows()
  windows.forEach((win) => {
    win.webContents.send('document:progress', progress)
  })
}

/**
 * 使用 LLM 生成文档大纲
 */
async function generateOutline(
  title: string,
  description: string,
  type: 'word' | 'ppt',
  ragContext: string
): Promise<DocumentOutline> {
  if (!cachedChatFunction) {
    throw new Error('LLM chat function not initialized')
  }

  const typeLabel = type === 'word' ? 'Word文档' : 'PPT演示文稿'
  const sectionLabel = type === 'word' ? '章节' : '幻灯片'

  const prompt = `请根据以下主题和参考资料，生成一份专业的${typeLabel}大纲。

主题：${title}
${description ? `详细要求：${description}` : ''}

参考资料摘要：
${ragContext.slice(0, 2000)}

请生成一个结构清晰的大纲，包含 4-6 个主要${sectionLabel}。

**重要：请严格按照以下 JSON 格式返回，不要添加任何其他内容：**

{
  "title": "文档标题",
  "subtitle": "副标题（可选）",
  "sections": [
    {
      "title": "${sectionLabel}1标题",
      "keyPoints": ["要点1", "要点2", "要点3"]
    },
    {
      "title": "${sectionLabel}2标题",
      "keyPoints": ["要点1", "要点2"]
    }
  ]
}

请直接返回 JSON，不要包含 markdown 代码块标记。`

  sendProgress({ stage: 'outline', percent: 20, message: '正在生成文档大纲...' })

  const result = await cachedChatFunction(prompt)
  let content = result.content.trim()

  // 清理可能的 markdown 代码块标记
  if (content.startsWith('```json')) {
    content = content.slice(7)
  } else if (content.startsWith('```')) {
    content = content.slice(3)
  }
  if (content.endsWith('```')) {
    content = content.slice(0, -3)
  }
  content = content.trim()

  try {
    const outline = JSON.parse(content) as DocumentOutline
    // 确保有必要的字段
    if (!outline.title) outline.title = title
    if (!outline.sections || outline.sections.length === 0) {
      // 解析成功但没有章节，让模型重新生成
      return await generateSimpleOutline(title, description, type)
    }
    // 为每个 section 添加 level
    outline.sections = outline.sections.map((s) => ({ ...s, level: 1 }))
    return outline
  } catch {
    console.error('Failed to parse outline JSON, retrying with simpler prompt...')
    // JSON 解析失败，用更简单的方式重试
    return await generateSimpleOutline(title, description, type)
  }
}

/**
 * 使用更简单的提示词生成大纲（作为备用方案）
 */
async function generateSimpleOutline(
  title: string,
  description: string,
  type: 'word' | 'ppt'
): Promise<DocumentOutline> {
  if (!cachedChatFunction) {
    throw new Error('LLM chat function not initialized')
  }

  const sectionCount = type === 'word' ? '4-5' : '5-6'

  const simplePrompt = `为"${title}"生成${sectionCount}个章节标题。
${description ? `要求：${description}` : ''}

只返回JSON格式：{"sections":["标题1","标题2","标题3","标题4"]}`

  try {
    const result = await cachedChatFunction(simplePrompt)
    let content = result.content.trim()

    // 清理代码块标记
    if (content.startsWith('```')) {
      content = content.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(content.trim())
    const sectionTitles: string[] = parsed.sections || []

    if (sectionTitles.length > 0) {
      return {
        title,
        subtitle: description,
        sections: sectionTitles.map((t) => ({
          title: t,
          level: 1,
          keyPoints: [] // 让内容生成阶段自行确定要点
        }))
      }
    }
  } catch {
    console.error('Simple outline generation also failed')
  }

  // 最终兜底：基于标题生成通用结构
  return {
    title,
    subtitle: description,
    sections: [
      { title: `${title}概述`, level: 1, keyPoints: [] },
      { title: `${title}详解`, level: 1, keyPoints: [] },
      { title: `${title}应用`, level: 1, keyPoints: [] },
      { title: `${title}总结`, level: 1, keyPoints: [] }
    ]
  }
}

/**
 * 使用 LLM 生成章节内容
 */
async function generateSectionContent(
  sectionTitle: string,
  keyPoints: string[],
  ragContext: string,
  type: 'word' | 'ppt'
): Promise<SectionContent> {
  if (!cachedChatFunction) {
    throw new Error('LLM chat function not initialized')
  }

  const typeLabel = type === 'word' ? '文档章节' : 'PPT幻灯片'
  const lengthHint = type === 'word' ? '每段 100-200 字' : '每段 50-100 字，简洁有力'

  const prompt = `请根据以下章节标题和参考资料，撰写${typeLabel}内容。

章节标题：${sectionTitle}
关键要点：${keyPoints.join('、')}

参考资料：
${ragContext.slice(0, 1500)}

要求：
1. 写 2-3 段正文内容，${lengthHint}
2. 提取 3-5 个关键要点作为列表
3. 内容专业、逻辑清晰

**重要：请严格按照以下 JSON 格式返回：**

{
  "paragraphs": ["第一段内容...", "第二段内容..."],
  "bulletPoints": ["要点1", "要点2", "要点3"]
}

请直接返回 JSON，不要包含 markdown 代码块标记。`

  const result = await cachedChatFunction(prompt)
  let content = result.content.trim()

  // 清理可能的 markdown 代码块标记
  if (content.startsWith('```json')) {
    content = content.slice(7)
  } else if (content.startsWith('```')) {
    content = content.slice(3)
  }
  if (content.endsWith('```')) {
    content = content.slice(0, -3)
  }
  content = content.trim()

  try {
    const parsed = JSON.parse(content)
    return {
      title: sectionTitle,
      paragraphs: parsed.paragraphs || [],
      bulletPoints: parsed.bulletPoints || keyPoints,
      sources: result.sources?.map((s) => s.fileName) || []
    }
  } catch {
    console.error('Failed to parse section content JSON, retrying with simpler prompt...')
    // 用更简单的方式重试
    return await generateSimpleSectionContent(sectionTitle, keyPoints, ragContext)
  }
}

/**
 * 使用更简单的提示词生成章节内容（作为备用方案）
 */
async function generateSimpleSectionContent(
  sectionTitle: string,
  keyPoints: string[],
  ragContext: string
): Promise<SectionContent> {
  if (!cachedChatFunction) {
    throw new Error('LLM chat function not initialized')
  }

  const simplePrompt = `请为"${sectionTitle}"写2段内容，并列出3个要点。
${keyPoints.length > 0 ? `参考要点：${keyPoints.join('、')}` : ''}
${ragContext ? `参考资料：${ragContext.slice(0, 500)}` : ''}

返回JSON：{"paragraphs":["段落1","段落2"],"bulletPoints":["要点1","要点2","要点3"]}`

  try {
    const result = await cachedChatFunction(simplePrompt)
    let content = result.content.trim()

    if (content.startsWith('```')) {
      content = content.replace(/^```\w*\n?/, '').replace(/\n?```$/, '')
    }

    const parsed = JSON.parse(content.trim())
    return {
      title: sectionTitle,
      paragraphs: parsed.paragraphs || [],
      bulletPoints: parsed.bulletPoints || keyPoints,
      sources: result.sources?.map((s) => s.fileName) || []
    }
  } catch {
    console.error('Simple section content generation also failed')
    // 最终兜底：让模型直接生成文本，不要求 JSON 格式
    return await generatePlainTextContent(sectionTitle, keyPoints)
  }
}

/**
 * 最终兜底：生成纯文本内容
 */
async function generatePlainTextContent(
  sectionTitle: string,
  keyPoints: string[]
): Promise<SectionContent> {
  if (!cachedChatFunction) {
    throw new Error('LLM chat function not initialized')
  }

  const plainPrompt = `请为"${sectionTitle}"写一段100字左右的介绍。${keyPoints.length > 0 ? `涉及：${keyPoints.join('、')}` : ''}`

  try {
    const result = await cachedChatFunction(plainPrompt)
    const text = result.content.trim()

    return {
      title: sectionTitle,
      paragraphs: [text],
      bulletPoints: keyPoints.length > 0 ? keyPoints : [],
      sources: result.sources?.map((s) => s.fileName) || []
    }
  } catch {
    // 真的全部失败了，返回空内容让用户自己填写
    return {
      title: sectionTitle,
      paragraphs: [],
      bulletPoints: keyPoints,
      sources: []
    }
  }
}

/**
 * 生成文档
 */
export async function generateDocument(
  request: DocumentGenerateRequest
): Promise<DocumentGenerateResult> {
  try {
    const { type, title, description, sources, theme = 'professional' } = request

    // 1. 检索相关内容
    sendProgress({ stage: 'outline', percent: 10, message: '正在检索相关资料...' })

    const searchResults = await searchSimilarDocuments(title + ' ' + (description || ''), {
      k: 10,
      sources
    })

    const ragContext = searchResults.map((doc) => doc.pageContent).join('\n\n')

    // 2. 生成大纲
    sendProgress({ stage: 'outline', percent: 20, message: '正在生成文档大纲...' })
    const outline = await generateOutline(title, description || '', type, ragContext)

    // 3. 生成各章节内容
    const contents: SectionContent[] = []
    const totalSections = outline.sections.length

    for (let i = 0; i < outline.sections.length; i++) {
      const section = outline.sections[i]
      const percent = 30 + Math.round((i / totalSections) * 50)
      sendProgress({
        stage: 'content',
        percent,
        message: `正在生成内容: ${section.title} (${i + 1}/${totalSections})`
      })

      // 为每个章节检索更精确的内容
      const sectionResults = await searchSimilarDocuments(section.title, {
        k: 5,
        sources
      })
      const sectionContext = sectionResults.map((doc) => doc.pageContent).join('\n\n')

      const content = await generateSectionContent(
        section.title,
        section.keyPoints || [],
        sectionContext || ragContext,
        type
      )
      contents.push(content)
    }

    // 4. 选择保存路径
    sendProgress({ stage: 'generating', percent: 85, message: '正在生成文档...' })

    const extension = type === 'word' ? 'docx' : 'pptx'
    const defaultFileName = `${title}.${extension}`

    // 获取主窗口
    const windows = BrowserWindow.getAllWindows()
    const mainWindow = windows[0] || null

    const { filePath, canceled } = await dialog.showSaveDialog(mainWindow || undefined, {
      title: `保存${type === 'word' ? 'Word文档' : 'PPT演示文稿'}`,
      defaultPath: defaultFileName,
      filters: [
        type === 'word'
          ? { name: 'Word文档', extensions: ['docx'] }
          : { name: 'PowerPoint演示文稿', extensions: ['pptx'] }
      ]
    })

    if (canceled || !filePath) {
      sendProgress({ stage: 'complete', percent: 100, message: '已取消' })
      return { success: false, error: '用户取消保存' }
    }

    // 5. 生成并保存文档
    sendProgress({ stage: 'generating', percent: 90, message: '正在写入文件...' })

    if (type === 'word') {
      await generateWordDocument(outline, contents, filePath, theme)
    } else {
      await generatePPTDocument(outline, contents, filePath, theme)
    }

    sendProgress({ stage: 'complete', percent: 100, message: '文档生成完成！' })

    return { success: true, filePath }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : '未知错误'
    sendProgress({
      stage: 'error',
      percent: 0,
      message: `生成失败: ${errorMessage}`,
      error: errorMessage
    })
    return { success: false, error: errorMessage }
  }
}

export default generateDocument
