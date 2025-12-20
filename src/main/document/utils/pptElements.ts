import PptxGenJS from 'pptxgenjs'
import type { DocumentTheme } from '../types'
import { THEME_COLORS, FONTS, PAGE_CONFIG } from './pptStyles'

/**
 * 截断文本到指定长度（智能截断，不会在词中间断开）
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  const truncated = text.slice(0, maxLength)
  // 尝试在标点符号或空格处截断
  const lastPunctuation = Math.max(
    truncated.lastIndexOf('。'),
    truncated.lastIndexOf('，'),
    truncated.lastIndexOf('；'),
    truncated.lastIndexOf('、'),
    truncated.lastIndexOf(' ')
  )
  if (lastPunctuation > maxLength * 0.7) {
    return truncated.slice(0, lastPunctuation + 1) + '...'
  }
  return truncated + '...'
}

/**
 * 将长段落分割成多个较短的段落
 */
export function splitParagraph(text: string, maxLength: number): string[] {
  if (text.length <= maxLength) return [text]

  const result: string[] = []
  let remaining = text

  while (remaining.length > 0) {
    if (remaining.length <= maxLength) {
      result.push(remaining)
      break
    }

    // 在适当位置分割
    let splitIndex = remaining.lastIndexOf('。', maxLength)
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf('，', maxLength)
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.5) {
      splitIndex = remaining.lastIndexOf('；', maxLength)
    }
    if (splitIndex === -1 || splitIndex < maxLength * 0.3) {
      splitIndex = maxLength
    } else {
      splitIndex += 1 // 包含标点符号
    }

    result.push(remaining.slice(0, splitIndex))
    remaining = remaining.slice(splitIndex).trim()
  }

  return result
}

/**
 * 创建封面幻灯片（增强版：渐变背景和更现代的设计）
 */
export function createTitleSlide(
  pptx: PptxGenJS,
  title: string,
  subtitle?: string,
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 渐变背景块
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: '50%',
    fill: { color: colors.primary }
  })

  // 底部渐变过渡
  slide.addShape('rect', {
    x: 0,
    y: 2.5,
    w: '100%',
    h: 0.3,
    fill: { color: colors.secondary, transparency: 50 }
  })

  // 装饰性强调线
  slide.addShape('rect', {
    x: 0,
    y: 2.75,
    w: '40%',
    h: 0.08,
    fill: { color: colors.highlight }
  })

  // 主标题（增强阴影效果）
  slide.addText(title, {
    x: 0.5,
    y: 1.0,
    w: '90%',
    h: 1.5,
    fontSize: 56,
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    align: 'center',
    valign: 'middle',
    shadow: {
      type: 'outer',
      blur: 3,
      offset: 2,
      angle: 45,
      color: '000000',
      opacity: 0.3
    }
  })

  // 副标题
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.5,
      y: 3.2,
      w: '90%',
      h: 0.8,
      fontSize: 26,
      fontFace: FONTS.body,
      color: colors.secondary,
      align: 'center',
      valign: 'middle',
      italic: true
    })
  }

  // 底部信息区
  slide.addShape('rect', {
    x: 0,
    y: 4.6,
    w: '100%',
    h: 0.8,
    fill: { color: colors.background, transparency: 0 }
  })

  // 日期
  slide.addText(
    new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }),
    {
      x: 0.5,
      y: 4.7,
      w: '90%',
      h: 0.5,
      fontSize: 16,
      fontFace: FONTS.body,
      color: colors.lightText,
      align: 'center'
    }
  )
}

/**
 * 创建目录幻灯片（增强版：支持更多章节和更好的布局）
 */
export function createTOCSlide(
  pptx: PptxGenJS,
  sections: { title: string }[],
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 侧边装饰条
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 0.15,
    h: '100%',
    fill: { color: colors.primary }
  })

  // 标题
  slide.addText('目  录', {
    x: 0.5,
    y: 0.3,
    w: '90%',
    h: 0.8,
    fontSize: 40,
    fontFace: FONTS.title,
    color: colors.primary,
    bold: true
  })

  // 标题下划线
  slide.addShape('rect', {
    x: 0.5,
    y: 1.1,
    w: 2,
    h: 0.06,
    fill: { color: colors.accent }
  })

  // 根据章节数量决定布局
  const maxItemsPerColumn = 5
  const needsTwoColumns = sections.length > maxItemsPerColumn

  if (needsTwoColumns) {
    // 双栏布局
    const midPoint = Math.ceil(sections.length / 2)
    const leftItems = sections.slice(0, midPoint)
    const rightItems = sections.slice(midPoint)

    // 左栏
    const leftTocItems = leftItems.map((s, i) => ({
      text: `${i + 1}. ${s.title}`,
      options: {
        fontSize: 20,
        fontFace: FONTS.body,
        color: colors.text,
        bullet: false,
        paraSpaceBefore: i === 0 ? 15 : 12,
        paraSpaceAfter: 10
      }
    }))

    slide.addText(leftTocItems, {
      x: 0.5,
      y: 1.4,
      w: 4.5,
      h: 3.8
    })

    // 右栏
    const rightTocItems = rightItems.map((s, i) => ({
      text: `${midPoint + i + 1}. ${s.title}`,
      options: {
        fontSize: 20,
        fontFace: FONTS.body,
        color: colors.text,
        bullet: false,
        paraSpaceBefore: i === 0 ? 15 : 12,
        paraSpaceAfter: 10
      }
    }))

    slide.addText(rightTocItems, {
      x: 5.2,
      y: 1.4,
      w: 4.5,
      h: 3.8
    })
  } else {
    // 单栏布局
    const tocItems = sections.map((s, i) => ({
      text: `${i + 1}. ${s.title}`,
      options: {
        fontSize: 22,
        fontFace: FONTS.body,
        color: colors.text,
        bullet: false,
        paraSpaceBefore: i === 0 ? 20 : 15,
        paraSpaceAfter: 12
      }
    }))

    slide.addText(tocItems, {
      x: 0.5,
      y: 1.4,
      w: '90%',
      h: 3.8
    })
  }

  // 底部装饰
  slide.addShape('rect', {
    x: 0,
    y: 5.2,
    w: '100%',
    h: 0.04,
    fill: { color: colors.accent, transparency: 60 }
  })
}

/**
 * 创建章节标题幻灯片（增强版：更震撼的视觉效果）
 */
export function createSectionTitleSlide(
  pptx: PptxGenJS,
  title: string,
  sectionNumber: number,
  totalSections: number,
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 全屏背景
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: '100%',
    fill: { color: colors.primary }
  })

  // 大号章节编号（装饰性）
  slide.addText(String(sectionNumber).padStart(2, '0'), {
    x: -0.5,
    y: 0.5,
    w: 4,
    h: 3,
    fontSize: 180,
    fontFace: FONTS.english,
    color: 'FFFFFF',
    bold: true,
    transparency: 85
  })

  // 章节进度指示
  const progressText = `${sectionNumber} / ${totalSections}`
  slide.addText(progressText, {
    x: 8,
    y: 0.3,
    w: 1.5,
    h: 0.5,
    fontSize: 14,
    fontFace: FONTS.english,
    color: 'FFFFFF',
    transparency: 40,
    align: 'right'
  })

  // 装饰线
  slide.addShape('rect', {
    x: 1.5,
    y: 2.3,
    w: 1.5,
    h: 0.08,
    fill: { color: colors.highlight }
  })

  // 章节标题
  slide.addText(title, {
    x: 1.5,
    y: 2.5,
    w: 7,
    h: 1.5,
    fontSize: 44,
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    valign: 'top'
  })

  // 副标题（章节编号）
  slide.addText(`第 ${sectionNumber} 章`, {
    x: 1.5,
    y: 4.2,
    w: 3,
    h: 0.5,
    fontSize: 18,
    fontFace: FONTS.body,
    color: 'FFFFFF',
    transparency: 30
  })
}

/**
 * 创建内容幻灯片（增强版：智能布局和更好的可读性）
 */
export function createContentSlide(
  pptx: PptxGenJS,
  title: string,
  content: string[],
  bullets?: string[],
  theme: DocumentTheme = 'professional',
  layout: 'default' | 'twoColumn' | 'bulletFocus' = 'default'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 左侧装饰条
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: 0.12,
    h: '100%',
    fill: { color: colors.primary }
  })

  // 标题区域背景
  slide.addShape('rect', {
    x: 0.12,
    y: 0,
    w: '100%',
    h: 1.0,
    fill: { color: colors.background }
  })

  // 标题
  slide.addText(title, {
    x: 0.4,
    y: 0.25,
    w: '85%',
    h: 0.7,
    fontSize: 30,
    fontFace: FONTS.title,
    color: colors.primary,
    bold: true,
    valign: 'middle'
  })

  // 标题下划线
  slide.addShape('rect', {
    x: 0.4,
    y: 1.0,
    w: 3,
    h: 0.04,
    fill: { color: colors.accent }
  })

  if (layout === 'twoColumn' && content.length > 0 && bullets && bullets.length > 0) {
    // 双栏布局：左侧段落，右侧要点
    // 左栏 - 段落
    const paragraphText = content.map((para, index) => ({
      text: para,
      options: {
        fontSize: 16,
        fontFace: FONTS.body,
        color: colors.text,
        paraSpaceBefore: index === 0 ? 10 : 14,
        paraSpaceAfter: 10,
        bullet: false
      }
    }))

    slide.addText(paragraphText, {
      x: 0.4,
      y: 1.3,
      w: 4.5,
      h: 3.6
    })

    // 右栏 - 要点
    const bulletItems = bullets.map((item, index) => ({
      text: item,
      options: {
        fontSize: 16,
        fontFace: FONTS.body,
        color: colors.text,
        bullet: {
          type: 'bullet' as const,
          color: colors.accent
        },
        paraSpaceBefore: index === 0 ? 10 : 12,
        paraSpaceAfter: 8,
        indentLevel: 0
      }
    }))

    slide.addText(bulletItems as PptxGenJS.TextProps[], {
      x: 5.2,
      y: 1.3,
      w: 4.3,
      h: 3.6
    })
  } else if (layout === 'bulletFocus' || (bullets && bullets.length > 0 && content.length === 0)) {
    // 要点焦点布局：大号要点列表
    const bulletItems = (bullets || []).map((item, index) => ({
      text: item,
      options: {
        fontSize: 20,
        fontFace: FONTS.body,
        color: colors.text,
        bullet: {
          type: 'bullet' as const,
          color: colors.accent,
          size: 110
        },
        paraSpaceBefore: index === 0 ? 15 : 18,
        paraSpaceAfter: 12,
        indentLevel: 0
      }
    }))

    slide.addText(bulletItems as PptxGenJS.TextProps[], {
      x: 0.5,
      y: 1.3,
      w: '90%',
      h: 3.8
    })
  } else {
    // 默认布局：段落在上，要点在下
    let currentY = 1.3

    // 内容段落
    if (content.length > 0) {
      const paragraphText = content.map((para, index) => ({
        text: para,
        options: {
          fontSize: 18,
          fontFace: FONTS.body,
          color: colors.text,
          paraSpaceBefore: index === 0 ? 10 : 16,
          paraSpaceAfter: 12,
          bullet: false
        }
      }))

      const paragraphHeight = bullets && bullets.length > 0 ? 2.0 : 3.6
      slide.addText(paragraphText, {
        x: 0.5,
        y: currentY,
        w: '90%',
        h: paragraphHeight
      })

      currentY += paragraphHeight + 0.2
    }

    // 要点列表
    if (bullets && bullets.length > 0) {
      const bulletItems = bullets.map((item, index) => ({
        text: item,
        options: {
          fontSize: 17,
          fontFace: FONTS.body,
          color: colors.text,
          bullet: {
            type: 'bullet' as const,
            color: colors.accent,
            size: 100
          },
          paraSpaceBefore: index === 0 ? 10 : 12,
          paraSpaceAfter: 8,
          indentLevel: 0
        }
      }))

      slide.addText(bulletItems as PptxGenJS.TextProps[], {
        x: 0.5,
        y: currentY,
        w: '90%',
        h: 5.1 - currentY
      })
    }
  }

  // 页脚装饰线
  slide.addShape('rect', {
    x: 0,
    y: 5.2,
    w: '100%',
    h: 0.03,
    fill: { color: colors.accent, transparency: 70 }
  })
}

/**
 * 创建引用幻灯片（新增功能：用于强调重要观点）
 */
export function createQuoteSlide(
  pptx: PptxGenJS,
  quote: string,
  source?: string,
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 深色背景
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: '100%',
    fill: { color: colors.primary }
  })

  // 引号装饰
  slide.addText('"', {
    x: 0.3,
    y: 0.8,
    w: 2,
    h: 2,
    fontSize: 200,
    fontFace: FONTS.english,
    color: 'FFFFFF',
    transparency: 80
  })

  // 引用文字
  slide.addText(quote, {
    x: 1,
    y: 1.8,
    w: 8,
    h: 2.5,
    fontSize: 28,
    fontFace: FONTS.quote,
    color: 'FFFFFF',
    align: 'center',
    valign: 'middle',
    italic: true
  })

  // 来源
  if (source) {
    slide.addText(`— ${source}`, {
      x: 1,
      y: 4.4,
      w: 8,
      h: 0.5,
      fontSize: 16,
      fontFace: FONTS.body,
      color: 'FFFFFF',
      transparency: 40,
      align: 'right'
    })
  }
}

/**
 * 创建总结幻灯片（增强版：更清晰的视觉层次）
 */
export function createSummarySlide(
  pptx: PptxGenJS,
  title: string,
  keyPoints: string[],
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 左侧强调区
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '25%',
    h: '100%',
    fill: { color: colors.primary }
  })

  // 装饰线
  slide.addShape('rect', {
    x: 2.45,
    y: 0,
    w: 0.1,
    h: '100%',
    fill: { color: colors.highlight }
  })

  // 左侧标题
  slide.addText(title, {
    x: 0.3,
    y: 1.8,
    w: 2,
    h: 1.5,
    fontSize: 32,
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    valign: 'middle'
  })

  // 右侧要点列表（编号式）
  const bulletItems = keyPoints.map((item, index) => ({
    text: `${index + 1}. ${item}`,
    options: {
      fontSize: 20,
      fontFace: FONTS.body,
      color: colors.text,
      bullet: false,
      paraSpaceBefore: index === 0 ? 10 : 20,
      paraSpaceAfter: 15
    }
  }))

  slide.addText(bulletItems, {
    x: 3,
    y: 0.8,
    w: 6.5,
    h: 4.2
  })

  // 底部装饰
  slide.addShape('rect', {
    x: 3,
    y: 5.0,
    w: 6.5,
    h: 0.04,
    fill: { color: colors.accent, transparency: 50 }
  })
}

/**
 * 创建参考文献幻灯片（增强版：更好的排版）
 */
export function createReferencesSlide(
  pptx: PptxGenJS,
  sources: string[],
  theme: DocumentTheme = 'professional'
): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 顶部装饰条
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: 0.08,
    fill: { color: colors.primary }
  })

  // 标题
  slide.addText('参考文献', {
    x: 0.5,
    y: 0.3,
    w: '90%',
    h: 0.7,
    fontSize: 28,
    fontFace: FONTS.title,
    color: colors.primary,
    bold: true
  })

  // 标题下划线
  slide.addShape('rect', {
    x: 0.5,
    y: 1.0,
    w: 2,
    h: 0.04,
    fill: { color: colors.accent }
  })

  // 参考文献列表（限制显示数量，避免过于拥挤）
  const maxRefs = 8
  const displaySources = sources.slice(0, maxRefs)
  const hasMore = sources.length > maxRefs

  const refItems: { text: string; options: PptxGenJS.TextPropsOptions }[] = displaySources.map(
    (source, index) => ({
      text: `[${index + 1}] ${source}`,
      options: {
        fontSize: 12,
        fontFace: FONTS.body,
        color: colors.lightText,
        bullet: false,
        paraSpaceBefore: index === 0 ? 10 : 8,
        paraSpaceAfter: 6
      }
    })
  )

  // 如果有更多参考文献，添加省略提示
  if (hasMore) {
    refItems.push({
      text: `... 及其他 ${sources.length - maxRefs} 个参考文献`,
      options: {
        fontSize: 11,
        fontFace: FONTS.body,
        color: colors.lightText,
        bullet: false,
        paraSpaceBefore: 10,
        paraSpaceAfter: 0,
        italic: true
      } as PptxGenJS.TextPropsOptions
    })
  }

  slide.addText(refItems, {
    x: 0.5,
    y: 1.2,
    w: '90%',
    h: 4
  })
}

/**
 * 创建结尾幻灯片（增强版：更有冲击力的设计）
 */
export function createEndSlide(pptx: PptxGenJS, theme: DocumentTheme = 'professional'): void {
  const colors = THEME_COLORS[theme]
  const slide = pptx.addSlide()

  // 全屏背景
  slide.addShape('rect', {
    x: 0,
    y: 0,
    w: '100%',
    h: '100%',
    fill: { color: colors.primary }
  })

  // 装饰性大圆（半透明）
  slide.addShape('ellipse', {
    x: 6,
    y: -1,
    w: 6,
    h: 6,
    fill: { color: 'FFFFFF', transparency: 92 }
  })

  slide.addShape('ellipse', {
    x: -2,
    y: 3,
    w: 4,
    h: 4,
    fill: { color: 'FFFFFF', transparency: 95 }
  })

  // 主文字
  slide.addText('感谢观看', {
    x: 0,
    y: 1.8,
    w: '100%',
    h: 1.2,
    fontSize: 56,
    fontFace: FONTS.title,
    color: 'FFFFFF',
    bold: true,
    align: 'center',
    valign: 'middle',
    shadow: {
      type: 'outer',
      blur: 4,
      offset: 2,
      angle: 45,
      color: '000000',
      opacity: 0.2
    }
  })

  // 英文副标题
  slide.addText('THANK YOU', {
    x: 0,
    y: 3.1,
    w: '100%',
    h: 0.6,
    fontSize: 20,
    fontFace: FONTS.english,
    color: 'FFFFFF',
    align: 'center',
    transparency: 40,
    charSpacing: 8
  })

  // 装饰线
  slide.addShape('rect', {
    x: 3.5,
    y: 3.9,
    w: 3,
    h: 0.06,
    fill: { color: colors.highlight }
  })

  // 日期
  slide.addText(
    new Date().toLocaleDateString('zh-CN', {
      year: 'numeric',
      month: 'long'
    }),
    {
      x: 0,
      y: 4.5,
      w: '100%',
      h: 0.4,
      fontSize: 14,
      fontFace: FONTS.body,
      color: 'FFFFFF',
      transparency: 50,
      align: 'center'
    }
  )
}

/**
 * 智能分页：将长内容拆分为多个幻灯片
 */
export function splitContentIntoSlides(
  title: string,
  paragraphs: string[],
  bullets: string[]
): {
  title: string
  paragraphs: string[]
  bullets: string[]
  layout: 'default' | 'twoColumn' | 'bulletFocus'
}[] {
  const slides: {
    title: string
    paragraphs: string[]
    bullets: string[]
    layout: 'default' | 'twoColumn' | 'bulletFocus'
  }[] = []

  // 处理段落：将长段落分割
  const processedParagraphs: string[] = []
  paragraphs.forEach((para) => {
    const splitParas = splitParagraph(para, PAGE_CONFIG.maxCharsPerParagraph)
    processedParagraphs.push(...splitParas)
  })

  // 处理要点：截断过长的要点
  const processedBullets = bullets.map((bullet) =>
    truncateText(bullet, PAGE_CONFIG.maxCharsPerBullet)
  )

  // 计算需要多少页
  const totalParagraphs = processedParagraphs.length
  const totalBullets = processedBullets.length

  // 只有要点的情况
  if (totalParagraphs === 0 && totalBullets > 0) {
    const bulletChunks: string[][] = []
    for (let i = 0; i < totalBullets; i += PAGE_CONFIG.maxBulletsPerSlide) {
      bulletChunks.push(processedBullets.slice(i, i + PAGE_CONFIG.maxBulletsPerSlide))
    }

    bulletChunks.forEach((chunk, index) => {
      slides.push({
        title: index === 0 ? title : `${title}（续）`,
        paragraphs: [],
        bullets: chunk,
        layout: 'bulletFocus'
      })
    })
    return slides
  }

  // 只有段落的情况
  if (totalBullets === 0 && totalParagraphs > 0) {
    const paragraphChunks: string[][] = []
    for (let i = 0; i < totalParagraphs; i += PAGE_CONFIG.maxParagraphsPerSlide) {
      paragraphChunks.push(processedParagraphs.slice(i, i + PAGE_CONFIG.maxParagraphsPerSlide))
    }

    paragraphChunks.forEach((chunk, index) => {
      slides.push({
        title: index === 0 ? title : `${title}（续）`,
        paragraphs: chunk,
        bullets: [],
        layout: 'default'
      })
    })
    return slides
  }

  // 段落和要点都有的情况：使用双栏布局或分页
  if (
    totalParagraphs <= PAGE_CONFIG.maxParagraphsPerSlide &&
    totalBullets <= PAGE_CONFIG.maxBulletsPerSlide
  ) {
    // 内容适合放在一页：使用双栏布局
    slides.push({
      title,
      paragraphs: processedParagraphs,
      bullets: processedBullets,
      layout: 'twoColumn'
    })
  } else {
    // 内容过多：分页处理
    // 第一页：段落
    const firstPageParagraphs = processedParagraphs.slice(0, PAGE_CONFIG.maxParagraphsPerSlide)
    const firstPageBullets = processedBullets.slice(
      0,
      Math.floor(PAGE_CONFIG.maxBulletsPerSlide / 2)
    )

    slides.push({
      title,
      paragraphs: firstPageParagraphs,
      bullets: firstPageBullets,
      layout: 'default'
    })

    // 剩余段落
    const remainingParagraphs = processedParagraphs.slice(PAGE_CONFIG.maxParagraphsPerSlide)
    if (remainingParagraphs.length > 0) {
      slides.push({
        title: `${title}（续）`,
        paragraphs: remainingParagraphs,
        bullets: [],
        layout: 'default'
      })
    }

    // 剩余要点
    const remainingBullets = processedBullets.slice(Math.floor(PAGE_CONFIG.maxBulletsPerSlide / 2))
    if (remainingBullets.length > 0) {
      const bulletChunks: string[][] = []
      for (let i = 0; i < remainingBullets.length; i += PAGE_CONFIG.maxBulletsPerSlide) {
        bulletChunks.push(remainingBullets.slice(i, i + PAGE_CONFIG.maxBulletsPerSlide))
      }

      bulletChunks.forEach((chunk, index) => {
        slides.push({
          title: `${title}（要点${index > 0 ? ' - 续' : ''}）`,
          paragraphs: [],
          bullets: chunk,
          layout: 'bulletFocus'
        })
      })
    }
  }

  return slides
}
