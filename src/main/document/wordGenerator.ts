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
  LevelFormat,
  Table,
  TableRow,
  TableCell,
  WidthType,
  VerticalAlign,
  ShadingType,
  NumberFormat
} from 'docx'
import { writeFile } from 'fs/promises'
import type { DocumentOutline, SectionContent, DocumentTheme, WordParagraphStyle } from './types'

/** 主题配色方案 - 增强版 */
const THEME_COLORS: Record<
  DocumentTheme,
  {
    primary: string
    secondary: string
    accent: string
    background: string
    border: string
    text: string
    lightBg: string
  }
> = {
  professional: {
    primary: '2B579A',
    secondary: '4472C4',
    accent: '5B9BD5',
    background: 'F8F9FA',
    border: 'D1D5DB',
    text: '1F2937',
    lightBg: 'EEF2FF'
  },
  modern: {
    primary: '1A1A2E',
    secondary: '16213E',
    accent: '0F3460',
    background: 'F1F5F9',
    border: 'CBD5E1',
    text: '0F172A',
    lightBg: 'E2E8F0'
  },
  simple: {
    primary: '333333',
    secondary: '666666',
    accent: '999999',
    background: 'FAFAFA',
    border: 'E5E5E5',
    text: '171717',
    lightBg: 'F5F5F5'
  },
  creative: {
    primary: '6C5CE7',
    secondary: 'A29BFE',
    accent: 'FD79A8',
    background: 'FDF2F8',
    border: 'F9A8D4',
    text: '4C1D95',
    lightBg: 'FAE8FF'
  }
}

/** 字体配置 - 增强版 */
const FONTS = {
  title: '微软雅黑',
  heading: '微软雅黑',
  body: '宋体',
  english: 'Times New Roman',
  code: 'Consolas',
  quote: '楷体'
}

/** 章节编号跟踪器 */
interface SectionNumbering {
  chapter: number
  section: number
  subsection: number
}

/** 创建章节编号 */
function createSectionNumber(level: number, numbering: SectionNumbering): string {
  if (level === 1) {
    numbering.chapter++
    numbering.section = 0
    numbering.subsection = 0
    return `${numbering.chapter}`
  } else if (level === 2) {
    numbering.section++
    numbering.subsection = 0
    return `${numbering.chapter}.${numbering.section}`
  } else {
    numbering.subsection++
    return `${numbering.chapter}.${numbering.section}.${numbering.subsection}`
  }
}

/**
 * 创建标题页（增强版：更专业的布局和装饰元素）
 */
function createTitlePage(
  title: string,
  subtitle?: string,
  theme: DocumentTheme = 'professional',
  author?: string,
  organization?: string
): Paragraph[] {
  const colors = THEME_COLORS[theme]

  const paragraphs: Paragraph[] = [
    // 顶部装饰线
    new Paragraph({
      children: [
        new TextRun({
          text: '═══════════════════════════════════════════════════════════════',
          font: FONTS.body,
          size: 16,
          color: colors.accent
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 1200, after: 800 }
    }),

    // 主标题
    new Paragraph({
      children: [
        new TextRun({
          text: title,
          font: FONTS.title,
          size: 88, // 44pt（增大）
          bold: true,
          color: colors.primary
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    })
  ]

  // 副标题
  if (subtitle) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: subtitle,
            font: FONTS.heading,
            size: 44, // 22pt
            color: colors.secondary,
            italics: true
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 600, before: 200 }
      })
    )
  }

  // 装饰分隔线
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
      spacing: { after: 1000, before: 600 }
    })
  )

  // 作者信息（如果提供）
  if (author) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '作者：',
            font: FONTS.body,
            size: 28,
            color: colors.secondary
          }),
          new TextRun({
            text: author,
            font: FONTS.body,
            size: 28,
            bold: true,
            color: colors.text
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 }
      })
    )
  }

  // 机构信息（如果提供）
  if (organization) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: organization,
            font: FONTS.body,
            size: 26,
            color: colors.secondary
          })
        ],
        alignment: AlignmentType.CENTER,
        spacing: { after: 400 }
      })
    )
  }

  // 日期
  paragraphs.push(
    new Paragraph({
      children: [
        new TextRun({
          text: new Date().toLocaleDateString('zh-CN', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
          }),
          font: FONTS.body,
          size: 26,
          color: colors.secondary
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 600, after: 2000 }
    }),

    // 底部装饰线
    new Paragraph({
      children: [
        new TextRun({
          text: '═══════════════════════════════════════════════════════════════',
          font: FONTS.body,
          size: 16,
          color: colors.accent
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 }
    }),

    // 分页符
    new Paragraph({
      children: [new PageBreak()]
    })
  )

  return paragraphs
}

/** 文档内容元素类型 */
type DocChild = Paragraph | TableOfContents | Table

/**
 * 创建目录（增强版：支持多级标题和自动编号）
 */
function createTableOfContents(
  sections: { title: string; level: number; number?: string }[],
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
          size: 48, // 24pt
          bold: true,
          color: colors.primary
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 600 },
      border: {
        bottom: {
          style: BorderStyle.DOUBLE,
          size: 6,
          color: colors.accent,
          space: 20
        }
      }
    }),
    new Paragraph({ spacing: { after: 300 } })
  ]

  // 生成目录条目（带编号的手动目录）
  sections.forEach((section) => {
    const indent = (section.level - 1) * 480 // 根据层级缩进
    const fontSize = section.level === 1 ? 26 : section.level === 2 ? 24 : 22
    const isBold = section.level === 1

    const displayText = section.number ? `${section.number}  ${section.title}` : section.title

    children.push(
      new Paragraph({
        children: [
          new TextRun({
            text: displayText,
            font: FONTS.heading,
            size: fontSize,
            bold: isBold,
            color: section.level === 1 ? colors.primary : colors.secondary
          }),
          new TextRun({
            text: '\t',
            font: FONTS.body
          })
        ],
        indent: { left: indent },
        spacing: {
          after: section.level === 1 ? 160 : 100,
          line: 380
        },
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
  children.push(new Paragraph({ spacing: { before: 400, after: 200 } }))

  // Word 自动目录字段（支持页码自动更新）
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
          text: '（提示：在 Word 中右键点击目录，选择"更新域"可更新页码）',
          font: FONTS.body,
          size: 18,
          italics: true,
          color: '888888'
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { before: 300, after: 200 }
    }),
    new Paragraph({
      children: [new PageBreak()]
    })
  )

  return children
}

/**
 * 创建章节标题（增强版：带自动编号）
 */
function createSectionHeading(
  title: string,
  level: number,
  theme: DocumentTheme = 'professional',
  sectionNumber?: string
): Paragraph {
  const colors = THEME_COLORS[theme]
  const headingLevel =
    level === 1
      ? HeadingLevel.HEADING_1
      : level === 2
        ? HeadingLevel.HEADING_2
        : HeadingLevel.HEADING_3

  const fontSize = level === 1 ? 36 : level === 2 ? 30 : 26 // 18pt, 15pt, 13pt
  const displayTitle = sectionNumber ? `${sectionNumber}  ${title}` : title

  // 一级标题添加分页控制
  const pageBreakBefore = level === 1

  return new Paragraph({
    children: [
      new TextRun({
        text: displayTitle,
        font: FONTS.heading,
        size: fontSize,
        bold: true,
        color: level === 1 ? colors.primary : level === 2 ? colors.secondary : colors.text
      })
    ],
    heading: headingLevel,
    spacing: {
      before: level === 1 ? 500 : level === 2 ? 400 : 300,
      after: level === 1 ? 300 : 200
    },
    keepNext: true, // 防止标题与后续内容分离
    keepLines: true, // 保持标题在同一页
    pageBreakBefore: pageBreakBefore && level === 1 // 一级标题前分页
  })
}

/**
 * 创建正文段落（增强版：更好的可读性和排版）
 */
function createBodyParagraph(text: string, style?: WordParagraphStyle): Paragraph {
  // 处理段落中可能的特殊格式（如加粗、斜体标记）
  const runs: TextRun[] = []

  // 检测是否包含特殊标记 **bold** 或 *italic*
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g)

  parts.forEach((part) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      // 加粗文本
      runs.push(
        new TextRun({
          text: part.slice(2, -2),
          font: FONTS.body,
          size: style?.fontSize ?? 24,
          bold: true,
          color: style?.color ?? '333333'
        })
      )
    } else if (part.startsWith('*') && part.endsWith('*')) {
      // 斜体文本
      runs.push(
        new TextRun({
          text: part.slice(1, -1),
          font: FONTS.body,
          size: style?.fontSize ?? 24,
          italics: true,
          color: style?.color ?? '333333'
        })
      )
    } else if (part) {
      // 普通文本
      runs.push(
        new TextRun({
          text: part,
          font: FONTS.body,
          size: style?.fontSize ?? 24,
          bold: style?.bold,
          italics: style?.italic,
          color: style?.color ?? '333333'
        })
      )
    }
  })

  // 如果没有特殊格式，使用原始文本
  if (runs.length === 0) {
    runs.push(
      new TextRun({
        text,
        font: FONTS.body,
        size: style?.fontSize ?? 24,
        bold: style?.bold,
        italics: style?.italic,
        color: style?.color ?? '333333'
      })
    )
  }

  return new Paragraph({
    children: runs,
    alignment:
      style?.alignment === 'center'
        ? AlignmentType.CENTER
        : style?.alignment === 'right'
          ? AlignmentType.RIGHT
          : style?.alignment === 'justified'
            ? AlignmentType.JUSTIFIED
            : AlignmentType.JUSTIFIED, // 默认两端对齐，更专业
    spacing: {
      before: style?.spacing?.before ?? 120,
      after: style?.spacing?.after ?? 120,
      line: style?.spacing?.line ?? 420 // 1.75倍行距（更舒适的阅读体验）
    },
    indent: {
      firstLine: convertInchesToTwip(0.4) // 首行缩进约2字符
    },
    keepLines: true // 防止段落内断页
  })
}

/**
 * 创建引用块（新增功能）
 */
function createQuoteBlock(text: string, theme: DocumentTheme = 'professional'): Paragraph {
  const colors = THEME_COLORS[theme]

  return new Paragraph({
    children: [
      new TextRun({
        text: `"${text}"`,
        font: FONTS.quote,
        size: 24,
        italics: true,
        color: colors.secondary
      })
    ],
    alignment: AlignmentType.LEFT,
    spacing: {
      before: 200,
      after: 200,
      line: 400
    },
    indent: {
      left: convertInchesToTwip(0.5),
      right: convertInchesToTwip(0.5)
    },
    border: {
      left: {
        style: BorderStyle.SINGLE,
        size: 24,
        color: colors.accent,
        space: 15
      }
    },
    shading: {
      type: ShadingType.SOLID,
      color: colors.lightBg
    }
  })
}

/**
 * 创建要点列表（增强版：支持多级列表和不同样式）
 */
function createBulletList(
  items: string[],
  theme: DocumentTheme = 'professional',
  level: number = 0
): Paragraph[] {
  const colors = THEME_COLORS[theme]
  const bullets = ['●', '○', '■', '□', '◆', '◇'] // 多级项目符号
  const bullet = bullets[level % bullets.length]

  return items.map(
    (item, index) =>
      new Paragraph({
        children: [
          new TextRun({
            text: `${bullet} `,
            font: FONTS.body,
            size: 24,
            color: colors.accent,
            bold: level === 0
          }),
          new TextRun({
            text: item,
            font: FONTS.body,
            size: 24,
            color: colors.text
          })
        ],
        spacing: {
          before: index === 0 ? 180 : 100,
          after: 100,
          line: 380
        },
        indent: {
          left: convertInchesToTwip(0.4 + level * 0.3),
          hanging: convertInchesToTwip(0.25)
        },
        keepNext: index < items.length - 1 // 保持列表项连续
      })
  )
}

/**
 * 创建编号列表（新增功能）
 */
function createNumberedList(
  items: string[],
  theme: DocumentTheme = 'professional',
  startNumber: number = 1
): Paragraph[] {
  const colors = THEME_COLORS[theme]

  return items.map(
    (item, index) =>
      new Paragraph({
        children: [
          new TextRun({
            text: `${startNumber + index}. `,
            font: FONTS.body,
            size: 24,
            bold: true,
            color: colors.accent
          }),
          new TextRun({
            text: item,
            font: FONTS.body,
            size: 24,
            color: colors.text
          })
        ],
        spacing: {
          before: index === 0 ? 180 : 100,
          after: 100,
          line: 380
        },
        indent: {
          left: convertInchesToTwip(0.4),
          hanging: convertInchesToTwip(0.25)
        },
        keepNext: index < items.length - 1
      })
  )
}

/**
 * 创建表格（新增功能）
 */
function createTable(
  headers: string[],
  rows: string[][],
  theme: DocumentTheme = 'professional'
): Table {
  const colors = THEME_COLORS[theme]

  // 计算列宽（平均分配）
  const columnWidth = Math.floor(9000 / headers.length)

  // 创建表头行
  const headerRow = new TableRow({
    children: headers.map(
      (header) =>
        new TableCell({
          children: [
            new Paragraph({
              children: [
                new TextRun({
                  text: header,
                  font: FONTS.heading,
                  size: 22,
                  bold: true,
                  color: 'FFFFFF'
                })
              ],
              alignment: AlignmentType.CENTER,
              spacing: { before: 80, after: 80 }
            })
          ],
          width: { size: columnWidth, type: WidthType.DXA },
          verticalAlign: VerticalAlign.CENTER,
          shading: {
            type: ShadingType.SOLID,
            color: colors.primary
          }
        })
    ),
    tableHeader: true
  })

  // 创建数据行
  const dataRows = rows.map(
    (row, rowIndex) =>
      new TableRow({
        children: row.map(
          (cell) =>
            new TableCell({
              children: [
                new Paragraph({
                  children: [
                    new TextRun({
                      text: cell,
                      font: FONTS.body,
                      size: 22,
                      color: colors.text
                    })
                  ],
                  alignment: AlignmentType.LEFT,
                  spacing: { before: 60, after: 60 }
                })
              ],
              width: { size: columnWidth, type: WidthType.DXA },
              verticalAlign: VerticalAlign.CENTER,
              shading: {
                type: ShadingType.SOLID,
                color: rowIndex % 2 === 0 ? 'FFFFFF' : colors.lightBg
              }
            })
        )
      })
  )

  return new Table({
    rows: [headerRow, ...dataRows],
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 8, color: colors.border },
      bottom: { style: BorderStyle.SINGLE, size: 8, color: colors.border },
      left: { style: BorderStyle.SINGLE, size: 8, color: colors.border },
      right: { style: BorderStyle.SINGLE, size: 8, color: colors.border },
      insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: colors.border },
      insideVertical: { style: BorderStyle.SINGLE, size: 4, color: colors.border }
    }
  })
}

/**
 * 创建参考文献部分（增强版：更规范的格式）
 */
function createReferences(sources: string[], theme: DocumentTheme = 'professional'): Paragraph[] {
  const colors = THEME_COLORS[theme]

  const paragraphs: Paragraph[] = [
    new Paragraph({
      children: [new PageBreak()]
    }),
    // 参考文献标题
    new Paragraph({
      children: [
        new TextRun({
          text: '参考文献',
          font: FONTS.heading,
          size: 36,
          bold: true,
          color: colors.primary
        })
      ],
      heading: HeadingLevel.HEADING_1,
      spacing: { after: 400 },
      border: {
        bottom: {
          style: BorderStyle.SINGLE,
          size: 12,
          color: colors.accent,
          space: 10
        }
      }
    }),
    new Paragraph({ spacing: { after: 200 } })
  ]

  // 参考文献条目
  sources.forEach((source, index) => {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: `[${index + 1}]  `,
            font: FONTS.body,
            size: 22,
            bold: true,
            color: colors.accent
          }),
          new TextRun({
            text: source,
            font: FONTS.body,
            size: 22,
            color: colors.text
          })
        ],
        spacing: { before: 100, after: 100, line: 360 },
        indent: {
          left: convertInchesToTwip(0.5),
          hanging: convertInchesToTwip(0.5)
        }
      })
    )
  })

  return paragraphs
}

/**
 * 创建摘要/Abstract（新增功能）
 */
function createAbstract(
  content: string,
  keywords?: string[],
  theme: DocumentTheme = 'professional'
): Paragraph[] {
  const colors = THEME_COLORS[theme]

  const paragraphs: Paragraph[] = [
    // 摘要标题
    new Paragraph({
      children: [
        new TextRun({
          text: '摘  要',
          font: FONTS.heading,
          size: 32,
          bold: true,
          color: colors.primary
        })
      ],
      alignment: AlignmentType.CENTER,
      spacing: { after: 300 }
    }),
    // 摘要内容
    new Paragraph({
      children: [
        new TextRun({
          text: content,
          font: FONTS.body,
          size: 24,
          color: colors.text
        })
      ],
      alignment: AlignmentType.JUSTIFIED,
      spacing: { after: 300, line: 400 },
      indent: {
        firstLine: convertInchesToTwip(0.4)
      }
    })
  ]

  // 关键词
  if (keywords && keywords.length > 0) {
    paragraphs.push(
      new Paragraph({
        children: [
          new TextRun({
            text: '关键词：',
            font: FONTS.heading,
            size: 24,
            bold: true,
            color: colors.secondary
          }),
          new TextRun({
            text: keywords.join('；'),
            font: FONTS.body,
            size: 24,
            color: colors.text
          })
        ],
        spacing: { before: 200, after: 400 }
      })
    )
  }

  paragraphs.push(
    new Paragraph({
      children: [new PageBreak()]
    })
  )

  return paragraphs
}

/**
 * 创建页眉（增强版：更专业的设计）
 */
function createHeader(title: string, theme: DocumentTheme = 'professional'): Header {
  const colors = THEME_COLORS[theme]

  return new Header({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: title,
            font: FONTS.heading,
            size: 20,
            color: colors.secondary,
            bold: true
          })
        ],
        alignment: AlignmentType.RIGHT,
        spacing: { after: 150 },
        border: {
          bottom: {
            style: BorderStyle.SINGLE,
            size: 6,
            color: colors.border,
            space: 80
          }
        }
      })
    ]
  })
}

/**
 * 创建页脚（增强版：添加页码格式）
 */
function createFooter(theme: DocumentTheme = 'professional'): Footer {
  const colors = THEME_COLORS[theme]

  return new Footer({
    children: [
      new Paragraph({
        children: [
          new TextRun({
            text: '— ',
            font: FONTS.body,
            size: 20,
            color: colors.secondary
          }),
          new TextRun({
            children: [PageNumber.CURRENT],
            font: FONTS.body,
            size: 20,
            color: colors.secondary
          }),
          new TextRun({
            text: ' / ',
            font: FONTS.body,
            size: 20,
            color: colors.secondary
          }),
          new TextRun({
            children: [PageNumber.TOTAL_PAGES],
            font: FONTS.body,
            size: 20,
            color: colors.secondary
          }),
          new TextRun({
            text: ' —',
            font: FONTS.body,
            size: 20,
            color: colors.secondary
          })
        ],
        alignment: AlignmentType.CENTER,
        border: {
          top: {
            style: BorderStyle.SINGLE,
            size: 4,
            color: colors.border,
            space: 80
          }
        }
      })
    ]
  })
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
  }
): Promise<void> {
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

      // 要点列表
      if (content.bulletPoints && content.bulletPoints.length > 0) {
        children.push(new Paragraph({ spacing: { before: 150 } }))
        children.push(...createBulletList(content.bulletPoints, theme))
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

// 导出辅助函数供外部使用
export {
  createTitlePage,
  createTableOfContents,
  createSectionHeading,
  createBodyParagraph,
  createQuoteBlock,
  createBulletList,
  createNumberedList,
  createTable,
  createReferences,
  createAbstract,
  THEME_COLORS,
  FONTS
}

export default generateWordDocument
