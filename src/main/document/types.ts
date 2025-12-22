/**
 * 文档生成相关类型定义
 */

export type {
  DocumentType,
  DocumentTheme,
  DocumentGenerateRequest,
  DocumentProgress,
  DocumentGenerateResult
} from '../../types/chat'

/** 文档大纲章节 */
export interface OutlineSection {
  /** 章节标题 */
  title: string
  /** 章节级别 (1-3) */
  level: number
  /** 章节关键点 */
  keyPoints?: string[]
  /** 子章节 */
  children?: OutlineSection[]
}

/** 文档大纲 */
export interface DocumentOutline {
  /** 文档标题 */
  title: string
  /** 副标题 */
  subtitle?: string
  /** 章节列表 */
  sections: OutlineSection[]
}

/** 生成的章节内容 */
export interface SectionContent {
  /** 章节标题 */
  title: string
  /** 章节内容段落 */
  paragraphs: string[]
  /** 要点列表 */
  bulletPoints?: string[]
  /** 引用来源 */
  sources?: string[]
  /** 引用块 */
  quotes?: string[]
  /** 表格数据 */
  tables?: {
    headers: string[]
    rows: string[][]
  }[]
}

/** Word 段落样式 */
export interface WordParagraphStyle {
  fontSize?: number
  bold?: boolean
  italic?: boolean
  color?: string
  alignment?: 'left' | 'center' | 'right' | 'justified'
  spacing?: {
    before?: number
    after?: number
    line?: number
  }
}

/** PPT 幻灯片布局 */
export type SlideLayout = 'title' | 'content' | 'twoColumn' | 'titleOnly' | 'blank'

/** PPT 幻灯片数据 */
export interface SlideData {
  /** 布局类型 */
  layout: SlideLayout
  /** 标题 */
  title?: string
  /** 副标题 */
  subtitle?: string
  /** 内容段落 */
  content?: string[]
  /** 要点列表 */
  bullets?: string[]
  /** 备注 */
  notes?: string
}
