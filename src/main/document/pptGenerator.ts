/**
 * PPT 演示文稿生成器
 * 使用 pptxgenjs 库生成专业格式的 PPT
 */
import PptxGenJS from 'pptxgenjs'
import type { DocumentOutline, SectionContent, DocumentTheme } from './types'

/** 主题配色方案 */
const THEME_COLORS: Record<
  DocumentTheme,
  {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
    lightText: string
  }
> = {
  professional: {
    primary: '2B579A',
    secondary: '4472C4',
    accent: '5B9BD5',
    background: 'FFFFFF',
    text: '333333',
    lightText: '666666'
  },
  modern: {
    primary: '1A1A2E',
    secondary: '16213E',
    accent: '0F3460',
    background: 'F8F9FA',
    text: '1A1A2E',
    lightText: '495057'
  },
  simple: {
    primary: '333333',
    secondary: '666666',
    accent: '0066CC',
    background: 'FFFFFF',
    text: '333333',
    lightText: '888888'
  },
  creative: {
    primary: '6C5CE7',
    secondary: 'A29BFE',
    accent: 'FD79A8',
    background: 'FAFAFA',
    text: '2D3436',
    lightText: '636E72'
  }
}

/** 字体配置 */
const FONTS = {
  title: '微软雅黑',
  body: '微软雅黑',
  english: 'Arial'
}

/**
 * 创建封面幻灯片（优化版：更现代的设计）
 */
function createTitleSlide(
  pptx: PptxGenJS,
  title: string,
  subtitle?: string,
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 背景装饰（优化：渐变效果）
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: '45%', // 稍微增加高度
    fill: { 
      color: colors.primary,
      transparency: 0 // 不透明
    },
    line: { color: colors.primary, width: 0 }
  })

  // 装饰性底部条（新增）
  slide.addShape('rect', {
    x: 0,
    y: 4.5,
    w: '100%',
    h: 0.15,
    fill: { color: colors.accent }
  })

  // 主标题（优化：更大的字体和更好的位置）
  slide.addText(title, {
    x: 0.5,
    y: 1.3, // 稍微上移
    w: '90%',
    h: 1.8, // 增加高度
    fontSize: 52, // 增大字体
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    align: 'center',
    valign: 'middle',
    lineSpacing: 1.2 // 行距
  })

  // 副标题（优化：更好的视觉层次）
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5,
      y: 3.3, // 调整位置
      w: '90%',
      h: 0.9,
      fontSize: 28, // 增大字体
      fontFace: FONTS.body,
      color: colors.lightText,
      align: 'center',
      valign: 'middle',
      italic: true // 添加斜体
    })
  }

  // 日期（优化：更好的格式和位置）
  slide.addText(
    new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      weekday: 'long'
    }),
    {
      x: 0.5,
      y: 4.8, // 调整位置
      w: '90%',
      h: 0.4,
      fontSize: 16, // 稍微增大
      fontFace: FONTS.body,
      color: colors.lightText,
      align: 'center'
    }
  )
}

/**
 * 创建目录幻灯片（优化版：更好的视觉层次）
 */
function createTOCSlide(
  pptx: PptxGenJS,
  sections: { title: string }[],
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 标题背景（新增：更专业的视觉设计）
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: 1.0,
    fill: { color: colors.primary }
  })

  // 标题（优化：白色文字在深色背景上）
  slide.addText('目  录', {
    x: 0.5,
    y: 0.2,
    w: '90%',
    h: 0.8,
    fontSize: 40, // 增大字体
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    align: 'center',
    valign: 'middle'
  })

  // 分隔线（优化：更明显）
  slide.addShape('rect', {
    x: 0.5,
    y: 1.2,
    w: '90%',
    h: 0.06, // 稍微加粗
    fill: { color: colors.accent }
  })

  // 目录项（优化：更好的间距和字体）
  const tocItems = sections.map((s, i) => ({
    text: `${i + 1}. ${s.title}`,
    options: {
      fontSize: 22, // 增大字体
      fontFace: FONTS.body,
      color: colors.text,
      bullet: false,
      paraSpaceBefore: i === 0 ? 20 : 18, // 优化间距
      paraSpaceAfter: 12,
      lineSpacing: 1.3 // 行距
    }
  }))

  slide.addText(tocItems, {
    x: 0.5,
    y: 1.5,
    w: '90%',
    h: 3.8 // 调整高度
  })
}

/**
 * 创建章节标题幻灯片
 */
function createSectionTitleSlide(
  pptx: PptxGenJS,
  title: string,
  sectionNumber: number,
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 背景色块（优化：更好的位置和大小）
  slide.addShape('rect', {
    x: 0,
    y: 1.8,
    w: '100%',
    h: 2.2,
    fill: { color: colors.primary }
  })

  // 装饰性底部条（新增）
  slide.addShape('rect', {
    x: 0,
    y: 4.0,
    w: '100%',
    h: 0.15,
    fill: { color: colors.accent }
  })

  // 章节编号（优化：更大的字体和更好的位置）
  slide.addText(`第 ${sectionNumber} 章`, {
    x: 0.5,
    y: 1.0,
    w: '90%',
    h: 0.7,
    fontSize: 22,
    fontFace: FONTS.body,
    color: colors.accent,
    bold: true,
    align: 'center'
  })

  // 章节标题（优化：更大的字体和更好的位置）
  slide.addText(title, {
    x: 0.5,
    y: 2.0,
    w: '90%',
    h: 1.6,
    fontSize: 48,
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    align: 'center',
    valign: 'middle',
    lineSpacing: 1.2
  })
}

/**
 * 创建内容幻灯片（优化版：更好的布局和可读性）
 */
function createContentSlide(
  pptx: PptxGenJS,
  title: string,
  content: string[],
  bullets?: string[],
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 标题背景条（新增：更专业的视觉层次）
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 0.2,
    h: 0.9,
    fill: { color: colors.primary }
  })

  // 标题（优化：更大的字体和更好的位置）
  slide.addText(title, {
    x: 0.3, // 从背景条后开始
    y: 0.25,
    w: '85%',
    h: 0.8,
    fontSize: 32, // 增大字体
    fontFace: FONTS.title,
    color: colors.primary,
    bold: true,
    valign: 'middle'
  })

  // 分隔线（优化：更粗更明显）
  slide.addShape('rect', {
    x: 0.3,
    y: 1.1,
    w: '85%',
    h: 0.05, // 稍微加粗
    fill: { color: colors.accent }
  })

  let currentY = 1.4 // 调整起始位置

  // 内容段落（优化：更好的间距和字体）
  if (content.length > 0) {
    const paragraphText = content.map((para, index) => ({
      text: para,
      options: {
        fontSize: 18, // 增大字体
        fontFace: FONTS.body,
        color: colors.text,
        paraSpaceBefore: index === 0 ? 12 : 16, // 第一段和后续段落的间距
        paraSpaceAfter: 12,
        bullet: false,
        lineSpacing: 1.3 // 行距
      }
    }))

    slide.addText(paragraphText, {
      x: 0.5,
      y: currentY,
      w: '90%',
      h: bullets && bullets.length > 0 ? 2.0 : 3.8 // 调整高度
    })

    currentY += bullets && bullets.length > 0 ? 2.2 : 0 // 调整间距
  }

  // 要点列表（优化：更好的视觉设计）
  if (bullets && bullets.length > 0) {
    const bulletItems = bullets.map((item, index) => ({
      text: item,
      options: {
        fontSize: 18, // 增大字体
        fontFace: FONTS.body,
        color: colors.text,
        bullet: { 
          type: 'bullet' as const, 
          color: colors.accent,
          size: 120 // 增大项目符号
        },
        paraSpaceBefore: index === 0 ? 12 : 14, // 优化间距
        paraSpaceAfter: 10,
        indentLevel: 0,
        lineSpacing: 1.25 // 行距
      }
    }))

    slide.addText(bulletItems as PptxGenJS.TextProps[], {
      x: 0.5,
      y: currentY,
      w: '90%',
      h: 2.8 // 调整高度
    })
  }

  // 页脚装饰线（优化：更精致的设计）
  slide.addShape('rect', {
    x: 0,
    y: 5.2,
    w: '100%',
    h: 0.05,
    fill: { color: colors.accent, transparency: 70 }
  })
}

/**
 * 创建总结幻灯片
 */
function createSummarySlide(
  pptx: PptxGenJS,
  title: string,
  keyPoints: string[],
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 背景渐变效果
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '30%',
    h: '100%',
    fill: { color: colors.primary }
  })

  // 标题
  slide.addText(title, {
    x: 0.3,
    y: 0.5,
    w: 2.5,
    h: 1,
    fontSize: 24,
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    valign: 'middle',
    rotate: 0
  })

  // 要点列表
  const bulletItems = keyPoints.map((item, index) => ({
    text: `${index + 1}. ${item}`,
    options: {
      fontSize: 18,
      fontFace: FONTS.body,
      color: colors.text,
      bullet: false,
      paraSpaceBefore: 15,
      paraSpaceAfter: 15
    }
  }))

  slide.addText(bulletItems, {
    x: 3.5,
    y: 1,
    w: 6,
    h: 4
  })
}

/**
 * 创建参考文献幻灯片
 */
function createReferencesSlide(
  pptx: PptxGenJS,
  sources: string[],
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 标题
  slide.addText('参考文献', {
    x: 0.5,
    y: 0.3,
    w: '90%',
    h: 0.8,
    fontSize: 28,
    fontFace: FONTS.title,
    color: colors.primary,
    bold: true
  })

  // 参考文献列表
  const refItems = sources.map((source, index) => ({
    text: `[${index + 1}] ${source}`,
    options: {
      fontSize: 12,
      fontFace: FONTS.body,
      color: colors.lightText,
      bullet: false,
      paraSpaceBefore: 8,
      paraSpaceAfter: 8
    }
  }))

  slide.addText(refItems, {
    x: 0.5,
    y: 1.2,
    w: '90%',
    h: 4
  })
}

/**
 * 创建结尾幻灯片
 */
function createEndSlide(pptx: PptxGenJS, theme: DocumentTheme = 'professional'): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 背景
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: '100%',
    fill: { color: colors.primary }
  })

  // 感谢语
  slide.addText('感谢观看', {
    x: 0,
    y: 2,
    w: '100%',
    h: 1.5,
    fontSize: 48,
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    align: 'center',
    valign: 'middle'
  })

  // 副文字
  slide.addText('THANK YOU', {
    x: 0,
    y: 3.5,
    w: '100%',
    h: 0.8,
    fontSize: 24,
    fontFace: FONTS.english,
    color: 'FFFFFF',
    align: 'center',
    transparency: 30
  })
}

/**
 * 生成 PPT 演示文稿
 */
export async function generatePPTDocument(
  outline: DocumentOutline,
  contents: SectionContent[],
  outputPath: string,
  theme: DocumentTheme = 'professional'
): Promise<void> {
  const colors = THEME_COLORS[theme]

  // 创建 PPT 实例
  const pptx = new PptxGenJS()

  // 设置元数据
  pptx.author = 'AI RAG Assistant'
  pptx.title = outline.title
  pptx.subject = outline.subtitle || outline.title
  pptx.company = 'AI Generated'

  // 设置默认布局
  pptx.layout = 'LAYOUT_16x9'

  // 设置主题色
  pptx.defineSlideMaster({
    title: 'MASTER_SLIDE',
    background: { color: colors.background },
    objects: [
      // 页码
      {
        placeholder: {
          options: {
            name: 'slideNumber',
            type: 'body' as const, // 使用 body 类型
            x: 9,
            y: 5.1,
            w: 0.6,
            h: 0.3,
            fontSize: 10,
            color: colors.lightText,
            align: 'right'
          },
          text: '{{slideNumber}}'
        }
      }
    ]
  })

  // 1. 封面幻灯片
  createTitleSlide(pptx, outline.title, outline.subtitle, theme)

  // 2. 目录幻灯片
  createTOCSlide(pptx, outline.sections, theme)

  // 3. 内容幻灯片
  let contentIndex = 0
  outline.sections.forEach((section, sectionIndex) => {
    // 章节标题页
    createSectionTitleSlide(pptx, section.title, sectionIndex + 1, theme)

    // 章节内容页
    if (contentIndex < contents.length) {
      const content = contents[contentIndex]
      contentIndex++

      // 优化：智能分页，确保内容不会太拥挤
      const paragraphs = content.paragraphs || []
      const bullets = content.bulletPoints || []

      if (paragraphs.length > 0 || bullets.length > 0) {
        // 计算每页最佳内容量
        const maxParagraphsPerPage = 2
        const maxBulletsPerPage = 5
        
        // 主内容页
        createContentSlide(
          pptx,
          section.title,
          paragraphs.slice(0, maxParagraphsPerPage),
          bullets.slice(0, maxBulletsPerPage),
          theme
        )

        // 如果有更多段落，创建额外的段落页
        if (paragraphs.length > maxParagraphsPerPage) {
          const remainingParagraphs = paragraphs.slice(maxParagraphsPerPage)
          const remainingBullets = bullets.slice(maxBulletsPerPage)
          
          // 如果还有要点，优先显示要点
          if (remainingBullets.length > 0) {
            createContentSlide(
              pptx,
              `${section.title}（续）`,
              remainingParagraphs.slice(0, 1), // 最多1段，留空间给要点
              remainingBullets,
              theme
            )
          } else if (remainingParagraphs.length > 0) {
            // 只有段落，可以多显示一些
            createContentSlide(
              pptx,
              `${section.title}（续）`,
              remainingParagraphs.slice(0, maxParagraphsPerPage),
              [],
              theme
            )
          }
        } else if (bullets.length > maxBulletsPerPage) {
          // 只有要点超出，创建额外的要点页
          createContentSlide(
            pptx,
            `${section.title}（要点）`,
            [],
            bullets.slice(maxBulletsPerPage),
            theme
          )
        }
      }
    }

    // 处理子章节
    if (section.children) {
      section.children.forEach((child) => {
        if (contentIndex < contents.length) {
          const childContent = contents[contentIndex]
          contentIndex++

          createContentSlide(
            pptx,
            child.title,
            childContent.paragraphs?.slice(0, 2) || [],
            childContent.bulletPoints?.slice(0, 5),
            theme
          )
        }
      })
    }
  })

  // 4. 总结幻灯片
  const summaryPoints = outline.sections.map((s) => s.title)
  createSummarySlide(pptx, '总  结', summaryPoints, theme)

  // 5. 参考文献幻灯片
  const allSources = new Set<string>()
  contents.forEach((section) => {
    section.sources?.forEach((s) => allSources.add(s))
  })
  if (allSources.size > 0) {
    createReferencesSlide(pptx, Array.from(allSources), theme)
  }

  // 6. 结尾幻灯片
  createEndSlide(pptx, theme)

  // 导出 PPT
  await pptx.writeFile({ fileName: outputPath })
}

export default generatePPTDocument
