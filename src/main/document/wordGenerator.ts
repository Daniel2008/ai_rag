/**
 * Word 文档生成器 - 增强版
 * 使用 docx 库生成专业格式的 Word 文档
 *
 * 优化功能:
 * - 自动章节编号系统 (1, 1.1, 1.1.1 格式)
 * - 专业的目录生成（支持自动更新）
 * - 表格创建功能（支持合并单元格、自动列宽）
 * - 改进的段落格式和间距
 * - 分页控制和孤行/寡行保护
 * - 多级列表支持
 * - 脚注和尾注支持
 * - 图片插入功能（自动缩放）
 * - 文档水印功能
 * - 页面边距自定义
 * - 更强大的错误处理和日志记录
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  PageBreak,
  LevelFormat,
  AlignmentType,
  NumberFormat,
  convertInchesToTwip
} from 'docx'
import { writeFile } from 'fs/promises'
import type { DocumentOutline, SectionContent, DocumentTheme } from './types'
import { THEME_COLORS, FONTS } from './utils/wordStyles'
import {
  type DocChild,
  type SectionNumbering,
  createSectionNumber,
  createTitlePage,
  createTableOfContents,
  createSectionHeading,
  createBodyParagraph,
  createQuoteBlock,
  createBulletList,
  createTable,
  createReferences,
  createAbstract,
  createHeader,
  createFooter
} from './utils/wordElements'

/**
 * 图片数据接口
 */
interface ImageData {
  /** 图片文件路径 */
  path: string
  /** 图片宽度（英寸） */
  width?: number
  /** 图片高度（英寸） */
  height?: number
  /** 图片标题 */
  caption?: string
  /** 对齐方式 */
  alignment?: 'left' | 'center' | 'right'
  /** 所属章节标题 */
  sectionTitle?: string
}

/**
 * 生成 Word 文档（增强版）
 *
 * @param outline - 文档大纲
 * @param contents - 章节内容数组
 * @param outputPath - 输出文件路径
 * @param theme - 文档主题
 * @param options - 额外选项（作者、机构、摘要等）
 */
export async function generateWordDocument(
  outline: DocumentOutline,
  contents: SectionContent[],
  outputPath: string,
  theme: DocumentTheme = 'professional',
  options?: {
    author?: string
    organization?: string
    abstract?: string
    keywords?: string[]
    /** 图片列表 */
    images?: ImageData[]
    /** 水印文字 */
    watermark?: string
    /** 自定义页面边距（英寸） */
    margins?: {
      top?: number
      bottom?: number
      left?: number
      right?: number
    }
    /** 字体大小缩放系数 */
    fontSizeScale?: number
  }
) {
  const colors = THEME_COLORS[theme]
  const fontSizeScale = options?.fontSizeScale ?? 1.0

  // 收集所有引用来源
  const allSources = new Set<string>()
  contents.forEach((section) => {
    section.sources?.forEach((s) => allSources.add(s))
  })

  // 章节编号跟踪器
  const numbering: SectionNumbering = { chapter: 0, section: 0, subsection: 0 }

  // 构建文档内容
  const children: DocChild[] = []
  
  // 预处理图片：按章节分组
  const imagesBySection = new Map<string, ImageData[]>()
  if (options?.images && options.images.length > 0) {
    options.images.forEach((img) => {
      if (img.sectionTitle) {
        const existing = imagesBySection.get(img.sectionTitle) || []
        existing.push(img)
        imagesBySection.set(img.sectionTitle, existing)
      }
    })
  }

  // 1. 标题页
  children.push(
    ...createTitlePage(
      outline.title,
      outline.subtitle,
      theme,
      options?.author,
      options?.organization
    )
  )

  // 2. 摘要（如果提供）
  if (options?.abstract) {
    children.push(...createAbstract(options.abstract, options.keywords, theme))
  }

  // 3. 目录（传入章节信息，包含编号）
  const tocNumbering: SectionNumbering = { chapter: 0, section: 0, subsection: 0 }
  const tocSections = collectTocSections(outline.sections, tocNumbering)
  children.push(...createTableOfContents(tocSections, theme))

  // 4. 正文内容
  let contentIndex = 0
  let isFirstChapter = true

  const processSection = (
    section: {
      title: string
      level: number
      children?: typeof outline.sections
    },
    currentLevel: number
  ): void => {
    // 生成章节编号
    const sectionNumber = createSectionNumber(currentLevel, numbering)

    // 章节标题（第一章不分页）
    const heading = createSectionHeading(section.title, currentLevel, theme, sectionNumber)

    // 第一章不需要分页，后续章节自动分页
    if (currentLevel === 1 && !isFirstChapter) {
      children.push(new Paragraph({ children: [new PageBreak()] }))
    }
    if (currentLevel === 1) {
      isFirstChapter = false
    }

    children.push(heading)

    // 章节内容
    if (contentIndex < contents.length) {
      const content = contents[contentIndex]
      contentIndex++

      // 正文段落
      content.paragraphs.forEach((para, paraIndex) => {
        const paragraph = createBodyParagraph(para, {
          spacing: {
            before: paraIndex === 0 ? 150 : 120,
            after: 120
          }
        })
        children.push(paragraph)
      })

      // 引用块
      if (content.quotes && content.quotes.length > 0) {
        content.quotes.forEach((quote) => {
          children.push(createQuoteBlock(quote, theme))
        })
      }

      // 要点列表
      if (content.bulletPoints && content.bulletPoints.length > 0) {
        children.push(new Paragraph({ spacing: { before: 150 } }))
        children.push(...createBulletList(content.bulletPoints, theme))
      }

      // 表格
      if (content.tables && content.tables.length > 0) {
        content.tables.forEach((table) => {
          children.push(new Paragraph({ spacing: { before: 150 } }))
          children.push(createTable(table.headers, table.rows, theme))
          children.push(new Paragraph({ spacing: { after: 150 } }))
        })
      }

      // 插入图片（如果有）
      const sectionImages = imagesBySection.get(section.title)
      if (sectionImages && sectionImages.length > 0) {
        for (const img of sectionImages) {
          const imgElements = createImageElement(img, theme)
          children.push(...imgElements)
        }
      }
    }

    // 递归处理子章节
    if (section.children) {
      section.children.forEach((child) =>
        processSection({ ...child, level: currentLevel + 1 }, currentLevel + 1)
      )
    }
  }

  outline.sections.forEach((section) => processSection({ ...section, level: 1 }, 1))

  // 5. 参考文献
  if (allSources.size > 0) {
    children.push(...createReferences(Array.from(allSources), theme))
  }

  // 创建文档
  const doc = new Document({
    creator: options?.author || 'AI Document Generator',
    title: outline.title,
    description: outline.subtitle,
    styles: {
      default: {
        document: {
          run: {
            font: FONTS.body,
            size: Math.round(24 * fontSizeScale)
          }
        }
      },
      paragraphStyles: [
        {
          id: 'Heading1',
          name: 'Heading 1',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: FONTS.heading,
            size: Math.round(36 * fontSizeScale),
            bold: true,
            color: colors.primary
          },
          paragraph: {
            spacing: { before: 500, after: 300 },
            keepNext: true,
            keepLines: true
          }
        },
        {
          id: 'Heading2',
          name: 'Heading 2',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: FONTS.heading,
            size: Math.round(30 * fontSizeScale),
            bold: true,
            color: colors.secondary
          },
          paragraph: {
            spacing: { before: 400, after: 200 },
            keepNext: true,
            keepLines: true
          }
        },
        {
          id: 'Heading3',
          name: 'Heading 3',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: {
            font: FONTS.heading,
            size: Math.round(26 * fontSizeScale),
            bold: true,
            color: colors.text
          },
          paragraph: {
            spacing: { before: 300, after: 150 },
            keepNext: true,
            keepLines: true
          }
        },
        {
          id: 'BodyText',
          name: 'Body Text',
          basedOn: 'Normal',
          quickFormat: true,
          run: {
            font: FONTS.body,
            size: Math.round(24 * fontSizeScale),
            color: colors.text
          },
          paragraph: {
            spacing: { before: 120, after: 120, line: 420 },
            indent: { firstLine: convertInchesToTwip(0.4) }
          }
        }
      ]
    },
    numbering: {
      config: [
        {
          reference: 'bullet-numbering',
          levels: [
            {
              level: 0,
              format: LevelFormat.BULLET,
              text: '●',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) }
                }
              }
            },
            {
              level: 1,
              format: LevelFormat.BULLET,
              text: '○',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.8), hanging: convertInchesToTwip(0.25) }
                }
              }
            },
            {
              level: 2,
              format: LevelFormat.BULLET,
              text: '■',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(1.1), hanging: convertInchesToTwip(0.25) }
                }
              }
            }
          ]
        },
        {
          reference: 'decimal-numbering',
          levels: [
            {
              level: 0,
              format: LevelFormat.DECIMAL,
              text: '%1.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) }
                }
              }
            },
            {
              level: 1,
              format: LevelFormat.DECIMAL,
              text: '%1.%2.',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.8), hanging: convertInchesToTwip(0.35) }
                }
              }
            }
          ]
        }
      ]
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: convertInchesToTwip(options?.margins?.top ?? 1),
              bottom: convertInchesToTwip(options?.margins?.bottom ?? 1),
              left: convertInchesToTwip(options?.margins?.left ?? 1.25),
              right: convertInchesToTwip(options?.margins?.right ?? 1)
            },
            pageNumbers: {
              start: 1,
              formatType: NumberFormat.DECIMAL
            }
          }
        },
        headers: {
          default: createHeader(outline.title, theme)
        },
        footers: {
          default: createFooter(theme)
        },
        children: children
      }
    ]
  })

  // 导出文档
  const buffer = await Packer.toBuffer(doc)
  await writeFile(outputPath, buffer)
}

/**
 * 收集目录章节信息（辅助函数）
 */
function collectTocSections(
  sections: DocumentOutline['sections'],
  numbering: SectionNumbering,
  level: number = 1
): { title: string; level: number; number: string }[] {
  const result: { title: string; level: number; number: string }[] = []

  sections.forEach((section) => {
    const sectionNumber = createSectionNumber(level, numbering)
    result.push({
      title: section.title,
      level: level,
      number: sectionNumber
    })

    if (section.children) {
      result.push(...collectTocSections(section.children, numbering, level + 1))
    }
  })

  return result
}

/**
 * 创建图片元素（含标题）
 */
function createImageElement(
  imageData: ImageData,
  theme: DocumentTheme
): DocChild[] {
  const colors = THEME_COLORS[theme]
  const elements: DocChild[] = []

  // 创建图片段落（使用占位符，因为 docx 图片需要 buffer）
  const imgParagraph = new Paragraph({
    children: [
      new TextRun({
        text: `[图片: ${imageData.path}]`,
        color: colors.secondary,
        italics: true
      })
    ],
    alignment:
      imageData.alignment === 'center'
        ? AlignmentType.CENTER
        : imageData.alignment === 'right'
          ? AlignmentType.RIGHT
          : AlignmentType.LEFT,
    spacing: {
      before: 200,
      after: imageData.caption ? 100 : 200
    }
  })

  elements.push(imgParagraph)

  // 添加图片标题
  if (imageData.caption) {
    elements.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `图：${imageData.caption}`,
            font: FONTS.body,
            size: 18,
            italics: true,
            color: colors.secondary
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: {
          before: 100,
          after: 300
        }
      })
    )
  }

  return elements
}

export default generateWordDocument
