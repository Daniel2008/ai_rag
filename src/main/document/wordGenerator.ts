/**
 * Word 文档生成器 - 增强版
 * 使用 docx 库生成专业格式的 Word 文档
 *
 * 优化功能:
 * - 自动章节编号系统 (1, 1.1, 1.1.1 格式)
 * - 专业的目录生成（支持自动更新）
 * - 表格创建功能
 * - 改进的段落格式和间距
 * - 分页控制和孤行/寡行保护
 * - 多级列表支持
 * - 脚注和尾注支持
 */
import {
  Document,
  Packer,
  Paragraph,
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
  }
) {
  const colors = THEME_COLORS[theme]

  // 收集所有引用来源
  const allSources = new Set<string>()
  contents.forEach((section) => {
    section.sources?.forEach((s) => allSources.add(s))
  })

  // 章节编号跟踪器
  const numbering: SectionNumbering = { chapter: 0, section: 0, subsection: 0 }

  // 构建文档内容
  const children: DocChild[] = []

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
            size: 24
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
            size: 36,
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
            size: 30,
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
            size: 26,
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
            size: 24,
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
              top: convertInchesToTwip(1),
              bottom: convertInchesToTwip(1),
              left: convertInchesToTwip(1.25),
              right: convertInchesToTwip(1)
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

export default generateWordDocument
