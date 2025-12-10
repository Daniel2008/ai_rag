/**
 * Word 文档生成器
 * 使用 docx 库生成专业格式的 Word 文档
 */
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  PageBreak,
  TableOfContents,
  StyleLevel,
  Header,
  Footer,
  PageNumber,
  TabStopPosition,
  TabStopType,
  BorderStyle,
  convertInchesToTwip,
  LevelFormat
} from 'docx'
import { writeFile } from 'fs/promises'
import type { DocumentOutline, SectionContent, DocumentTheme, WordParagraphStyle } from './types'

/** 主题配色方案 */
const THEME_COLORS: Record<DocumentTheme, { primary: string; secondary: string; accent: string }> =
  {
    professional: { primary: '2B579A', secondary: '4472C4', accent: '5B9BD5' },
    modern: { primary: '1A1A2E', secondary: '16213E', accent: '0F3460' },
    simple: { primary: '333333', secondary: '666666', accent: '999999' },
    creative: { primary: '6C5CE7', secondary: 'A29BFE', accent: 'FD79A8' }
  }

/** 字体配置 */
const FONTS = {
  title: '微软雅黑',
  heading: '微软雅黑',
  body: '宋体',
  english: 'Times New Roman'
}

/**
 * 创建标题页（优化版：更专业的布局）
 */
function createTitlePage(
  title: string,
  subtitle?: string,
  theme: DocumentTheme = 'professional'
): Paragraph[] {
  const colors = THEME_COLORS[theme]

  const paragraphs: Paragraph[] = [
    // 顶部空白（优化：根据是否有副标题调整）
    new Paragraph({ spacing: { before: subtitle ? 3500 : 4000 } }),

    // 主标题（优化：更大的字体和更好的间距）
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          font: FONTS.title,
          size: 80, // 40pt（增大）
          bold: true,
          color: colors.primary
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 } // 增加间距
    })
  ]

  // 副标题（优化：更好的视觉层次）
  if (subtitle) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: subtitle,
            font: FONTS.heading,
            size: 40, // 20pt（增大）
            color: colors.secondary,
            italics: true // 添加斜体
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 1000, before: 200 } // 优化间距
      })
    )
  }

  // 装饰分隔线（新增）
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
          font: FONTS.body,
          size: 20,
          color: colors.accent
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 1200, before: 400 }
    })
  )

  // 日期（优化：更好的格式和位置）
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
          }),
          font: FONTS.body,
          size: 26, // 13pt（稍微增大）
          color: colors.secondary
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 0, after: 3000 } // 优化底部间距
    }),
    // 分页符
    new Paragraph({
      children: [new PageBreak()]
    })
  )

  return paragraphs
}

/** 文档内容元素类型 */
type DocChild = Paragraph | TableOfContents

/**
 * 创建目录（手动生成 + Word 自动目录字段）
 */
function createTableOfContents(
  sections: { title: string; level: number }[],
  theme: DocumentTheme = 'professional'
): DocChild[] {
  const colors = THEME_COLORS[theme]

  const children: DocChild[] = [
    // 目录标题
    new Paragraph({
      children: [
        new TextRun({
          text: '目  录',
          font: FONTS.title,
          size: 44, // 22pt
          bold: true,
          color: colors.primary
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 }
    })
  ]

  // 生成目录条目（手动目录，打开即可见）
  sections.forEach((section, index) => {
    const indent = (section.level - 1) * 400 // 根据层级缩进
    const fontSize = section.level === 1 ? 24 : 22 // 一级标题稍大

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `${index + 1}. ${section.title}`,
            font: FONTS.heading,
            size: fontSize,
            color: section.level === 1 ? colors.primary : colors.secondary
          }),
          // 添加点线填充
          new TextRun({
            text: '\t',
            font: FONTS.body
          })
        ],
        indent: { left: indent },
        spacing: { after: 120, line: 360 },
        tabStops: [
          {
            type: TabStopType.RIGHT,
            position: TabStopPosition.MAX,
            leader: 'dot'
          }
        ]
      })
    )
  })

  // 分隔
  children.push(
    new Paragraph({
      spacing: { before: 400 }
    })
  )

  // Word 自动目录字段（支持页码更新）
  children.push(
    new TableOfContents('目录', {
      hyperlink: true,
      headingStyleRange: '1-3',
      stylesWithLevels: [
        new StyleLevel('Heading1', 1),
        new StyleLevel('Heading2', 2),
        new StyleLevel('Heading3', 3)
      ]
    })
  )

  // 提示和分页
  children.push(
    new Paragraph({
      children: [
        new TextRun({
          text: '（提示：在 Word 中按 Ctrl+A 全选，然后按 F9 更新目录页码）',
          font: FONTS.body,
          size: 18,
          italics: true,
          color: '888888'
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 200 }
    }),
    new Paragraph({
      children: [new PageBreak()]
    })
  )

  return children
}

/**
 * 创建章节标题
 */
function createSectionHeading(
  title: string,
  level: number,
  theme: DocumentTheme = 'professional'
): Paragraph {
  const colors = THEME_COLORS[theme]
  const headingLevel =
    level === 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3

  const fontSize = level === 1 ? 36 : level === 2 ? 28 : 24 // 18pt, 14pt, 12pt

  return new Paragraph({
    children: [
      new TextRun({
        text: title,
        font: FONTS.heading,
        size: fontSize,
        bold: true,
        color: level === 1 ? colors.primary : colors.secondary
      })
    ],
    heading: headingLevel,
    spacing: {
      before: level === 1 ? 400 : 300,
      after: 200
    }
  })
}

/**
 * 创建正文段落（优化版：更好的可读性）
 */
function createBodyParagraph(text: string, style?: WordParagraphStyle): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({
        text,
        font: FONTS.body,
        size: style?.fontSize ?? 24, // 12pt
        bold: style?.bold,
        italics: style?.italic,
        color: style?.color ?? '333333'
      })
    ],
    alignment:
      style?.alignment === 'center'
        ? AlignmentType.CENTER
        : style?.alignment === 'right'
          ? AlignmentType.RIGHT
          : style?.alignment === 'justified'
            ? AlignmentType.JUSTIFIED
            : AlignmentType.LEFT,
    spacing: {
      before: style?.spacing?.before ?? 120, // 增加段前间距
      after: style?.spacing?.after ?? 120, // 增加段后间距
      line: style?.spacing?.line ?? 400 // 1.67倍行距（更舒适）
    },
    indent: {
      firstLine: convertInchesToTwip(0.5) // 首行缩进 2 字符
    }
  })
}

/**
 * 创建要点列表（优化版：更好的视觉层次）
 */
function createBulletList(items: string[], theme: DocumentTheme = 'professional'): Paragraph[] {
  const colors = THEME_COLORS[theme]

  return items.map(
    (item, index) =>
      new Paragraph({
        children: [
          new TextRun({
            text: '▪ ', // 使用方形项目符号（更现代）
            font: FONTS.body,
            size: 28, // 稍微增大
            color: colors.accent,
            bold: true
          }),
          new TextRun({
            text: item,
            font: FONTS.body,
            size: 24,
            color: '333333'
          })
        ],
        spacing: { 
          before: index === 0 ? 150 : 100, // 第一项额外间距
          after: 100 
        },
        indent: { 
          left: convertInchesToTwip(0.5),
          hanging: convertInchesToTwip(0.3) // 悬挂缩进
        }
      })
  )
}

/**
 * 创建参考文献部分
 */
function createReferences(sources: string[], theme: DocumentTheme = 'professional'): Paragraph[] {
  const paragraphs: Paragraph[] = [
    new Paragraph({
      children: [new PageBreak()]
    }),
    createSectionHeading('参考文献', 1, theme),
    new Paragraph({ spacing: { after: 200 } })
  ]

  sources.forEach((source, index) => {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `[${index + 1}] `,
            font: FONTS.body,
            size: 22,
            bold: true
          }),
          new TextRun({
            text: source,
            font: FONTS.body,
            size: 22
          })
        ],
        spacing: { before: 80, after: 80 }
      })
    )
  })

  return paragraphs
}

/**
 * 创建页眉（优化版：更专业的设计）
 */
function createHeader(title: string): Header {
  return new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: title,
            font: FONTS.heading,
            size: 20, // 稍微增大
            color: '666666',
            bold: true // 加粗
          })
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 120 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 8, // 稍微加粗
            color: 'DDDDDD', // 更柔和的颜色
            space: 60 // 增加间距
          }
        }
      })
    ]
  })
}

/**
 * 创建页脚
 */
function createFooter(): Footer {
  return new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            children: [PageNumber.CURRENT]
          }),
          new TextRun({
            text: ' / '
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES]
          })
        ],
        alignment: AlignmentType.CENTER
      })
    ]
  })
}

/**
 * 生成 Word 文档
 */
export async function generateWordDocument(
  outline: DocumentOutline,
  contents: SectionContent[],
  outputPath: string,
  theme: DocumentTheme = 'professional'
): Promise<void> {
  // 收集所有引用来源
  const allSources = new Set<string>()
  contents.forEach((section) => {
    section.sources?.forEach((s) => allSources.add(s))
  })

  // 构建文档内容
  const children: DocChild[] = []

  // 1. 标题页
  children.push(...createTitlePage(outline.title, outline.subtitle, theme))

  // 2. 目录（传入章节信息）
  const tocSections = outline.sections.map((s) => ({ title: s.title, level: s.level || 1 }))
  children.push(...createTableOfContents(tocSections, theme))

  // 3. 正文内容
  let contentIndex = 0
  const processSection = (section: {
    title: string
    level: number
    children?: typeof outline.sections
  }): void => {
    // 章节标题
    children.push(createSectionHeading(section.title, section.level, theme))

    // 章节内容
    if (contentIndex < contents.length) {
      const content = contents[contentIndex]
      contentIndex++

      // 正文段落（优化：添加段落间距和格式）
      content.paragraphs.forEach((para, paraIndex) => {
        // 第一段后添加额外间距
        const paragraph = createBodyParagraph(para, {
          spacing: {
            before: paraIndex === 0 ? 100 : 100,
            after: paraIndex === 0 ? 200 : 100 // 第一段后额外间距
          }
        })
        children.push(paragraph)
      })

      // 要点列表
      if (content.bulletPoints && content.bulletPoints.length > 0) {
        children.push(new Paragraph({ spacing: { before: 100 } }))
        children.push(...createBulletList(content.bulletPoints, theme))
      }
    }

    // 递归处理子章节
    if (section.children) {
      section.children.forEach((child) => processSection({ ...child, level: section.level + 1 }))
    }
  }

  outline.sections.forEach((section) => processSection({ ...section, level: 1 }))

  // 4. 参考文献
  if (allSources.size > 0) {
    children.push(...createReferences(Array.from(allSources), theme))
  }

  // 创建文档
  const doc = new Document({
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
            color: THEME_COLORS[theme].primary
          },
          paragraph: {
            spacing: { before: 400, after: 200 }
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
            size: 28,
            bold: true,
            color: THEME_COLORS[theme].secondary
          },
          paragraph: {
            spacing: { before: 300, after: 150 }
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
            size: 24,
            bold: true,
            color: THEME_COLORS[theme].secondary
          },
          paragraph: {
            spacing: { before: 200, after: 100 }
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
              text: '•',
              alignment: AlignmentType.LEFT,
              style: {
                paragraph: {
                  indent: { left: convertInchesToTwip(0.5), hanging: convertInchesToTwip(0.25) }
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
            }
          }
        },
        headers: {
          default: createHeader(outline.title)
        },
        footers: {
          default: createFooter()
        },
        children: children
      }
    ]
  })

  // 导出文档
  const buffer = await Packer.toBuffer(doc)
  await writeFile(outputPath, buffer)
}

export default generateWordDocument
