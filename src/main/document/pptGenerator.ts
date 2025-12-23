/**
 * PPT 演示文稿生成器 - 增强版
 * 使用 pptxgenjs 库生成专业格式的 PPT
 *
 * 优化功能:
 * - 智能内容分页（自动根据内容长度分配幻灯片）
 * - 多种幻灯片布局（图文混排、双栏、全屏等）
 * - 增强的视觉设计（渐变、阴影、动画）
 * - 更好的长内容处理（自动截断和续页）
 * - 改进的排版和字体设置
 * - 图表支持（柱状图、饼图、折线图）
 * - 图片插入功能
 * - 幻灯片备注功能
 * - 自定义动画效果
 * - 更灵活的主题配置
 */
import PptxGenJS from 'pptxgenjs'
import type { DocumentOutline, SectionContent, DocumentTheme } from './types'
import { THEME_COLORS, FONTS, PAGE_CONFIG } from './utils/pptStyles'
import {
  createTitleSlide,
  createTOCSlide,
  createSectionTitleSlide,
  createContentSlide,
  createQuoteSlide,
  createSummarySlide,
  createReferencesSlide,
  createEndSlide,
  splitContentIntoSlides,
  truncateText,
  splitParagraph,
  createImageSlide,
  createChartSlide
} from './utils/pptElements'

/**
 * 图片数据接口
 */
export interface PPTImageData {
  /** 图片文件路径 */
  path: string
  /** 图片标题 */
  caption?: string
  /** 所属章节标题 */
  sectionTitle?: string
  /** 位置 */
  position?: 'left' | 'center' | 'right'
}

/**
 * 图表数据接口
 */
export interface PPTChartData {
  /** 图表类型 */
  type: 'bar' | 'pie' | 'line' | 'area'
  /** 图表标题 */
  title: string
  /** 数据标签 */
  labels: string[]
  /** 数据值 */
  data: number[]
  /** 数据系列名称（多系列图表） */
  dataSeries?: {
    name: string
    values: number[]
  }[]
  /** 所属章节标题 */
  sectionTitle?: string
}

/**
 * 生成 PPT 演示文稿（增强版）
 */
export async function generatePPTDocument(
  outline: DocumentOutline,
  contents: SectionContent[],
  outputPath: string,
  theme: DocumentTheme = 'professional',
  options?: {
    /** 图片列表 */
    images?: PPTImageData[]
    /** 图表列表 */
    charts?: PPTChartData[]
    /** 是否添加动画 */
    enableAnimations?: boolean
    /** 幻灯片备注 */
    notes?: Record<string, string>
    /** 布局比例 */
    layout?: 'LAYOUT_16x9' | 'LAYOUT_16x10' | 'LAYOUT_4x3'
  }
): Promise<void> {
  const colors = THEME_COLORS[theme]
  const totalSections = outline.sections.length

  // 创建 PPT 实例
  const pptx = new PptxGenJS()

  // 设置元数据
  pptx.author = 'AI RAG Assistant'
  pptx.title = outline.title
  pptx.subject = outline.subtitle || outline.title
  pptx.company = 'AI Generated'

  // 设置默认布局
  pptx.layout = options?.layout ?? 'LAYOUT_16x9'

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
            type: 'body' as const,
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

  // 预处理图片：按章节分组
  const imagesBySection = new Map<string, PPTImageData[]>()
  if (options?.images && options.images.length > 0) {
    options.images.forEach((img) => {
      if (img.sectionTitle) {
        const existing = imagesBySection.get(img.sectionTitle) || []
        existing.push(img)
        imagesBySection.set(img.sectionTitle, existing)
      }
    })
  }

  // 预处理图表：按章节分组
  const chartsBySection = new Map<string, PPTChartData[]>()
  if (options?.charts && options.charts.length > 0) {
    options.charts.forEach((chart) => {
      if (chart.sectionTitle) {
        const existing = chartsBySection.get(chart.sectionTitle) || []
        existing.push(chart)
        chartsBySection.set(chart.sectionTitle, existing)
      }
    })
  }

  // 1. 封面幻灯片
  createTitleSlide(pptx, outline.title, outline.subtitle, theme)

  // 2. 目录幻灯片
  createTOCSlide(pptx, outline.sections, theme)

  // 3. 内容幻灯片
  let contentIndex = 0
  outline.sections.forEach((section, sectionIndex) => {
    // 章节标题页
    createSectionTitleSlide(
      pptx,
      section.title,
      sectionIndex + 1,
      totalSections,
      theme
    )

    // 章节内容页
    if (contentIndex < contents.length) {
      const content = contents[contentIndex]
      contentIndex++

      const paragraphs = content.paragraphs || []
      const bullets = content.bulletPoints || []

      if (paragraphs.length > 0 || bullets.length > 0) {
        // 使用智能分页
        const slideContents = splitContentIntoSlides(section.title, paragraphs, bullets)

        slideContents.forEach((slideContent) => {
          const slide = createContentSlide(
            pptx,
            slideContent.title,
            slideContent.paragraphs,
            slideContent.bullets,
            theme,
            slideContent.layout
          )
          // 添加备注（如果有）
          const noteText = options?.notes?.[slideContent.title]
          if (noteText) {
            slide.addNotes(noteText)
          }
        })
      }
    }

    // 插入章节图片
    const sectionImages = imagesBySection.get(section.title)
    if (sectionImages && sectionImages.length > 0) {
      sectionImages.forEach((img) => {
        createImageSlide(pptx, img, theme)
      })
    }

    // 插入章节图表
    const sectionCharts = chartsBySection.get(section.title)
    if (sectionCharts && sectionCharts.length > 0) {
      sectionCharts.forEach((chart) => {
        createChartSlide(pptx, chart, theme)
      })
    }

    // 处理子章节
    if (section.children) {
      section.children.forEach((child) => {
        if (contentIndex < contents.length) {
          const childContent = contents[contentIndex]
          contentIndex++

          const childParagraphs = childContent.paragraphs || []
          const childBullets = childContent.bulletPoints || []

          if (childParagraphs.length > 0 || childBullets.length > 0) {
            const slideContents = splitContentIntoSlides(child.title, childParagraphs, childBullets)

            slideContents.forEach((slideContent) => {
              createContentSlide(
                pptx,
                slideContent.title,
                slideContent.paragraphs,
                slideContent.bullets,
                theme,
                slideContent.layout
              )
            })
          }
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

// 导出辅助函数和类型供外部使用
export {
  createTitleSlide,
  createTOCSlide,
  createSectionTitleSlide,
  createContentSlide,
  createQuoteSlide,
  createSummarySlide,
  createReferencesSlide,
  createEndSlide,
  createImageSlide,
  createChartSlide,
  splitContentIntoSlides,
  truncateText,
  splitParagraph,
  THEME_COLORS,
  FONTS,
  PAGE_CONFIG
}

export default generatePPTDocument
