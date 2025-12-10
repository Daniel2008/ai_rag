/**
 * 文档生成相关类型定义
 */

/** 文档类型 */
export type DocumentType = 'word' | 'ppt'

/** 文档主题风格 */
export type DocumentTheme = 'professional' | 'modern' | 'simple' | 'creative'

/** 文档生成请求 */
export interface DocumentGenerateRequest {
  /** 文档类型 */
  type: DocumentType
  /** 主题/标题 */
  title: string
  /** 详细描述/要求 */
  description?: string
  /** 使用的知识库文档路径 */
  sources?: string[]
  /** 主题风格 */
  theme?: DocumentTheme
  /** 目标章节/页数（可选） */
  targetSections?: number
}

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
}

/** 文档生成进度 */
export interface DocumentProgress {
  /** 当前阶段 */
  stage: 'outline' | 'content' | 'generating' | 'complete' | 'error'
  /** 进度百分比 (0-100) */
  percent: number
  /** 进度消息 */
  message: string
  /** 错误信息 */
  error?: string
}

/** 文档生成结果 */
export interface DocumentGenerateResult {
  /** 是否成功 */
  success: boolean
  /** 生成的文件路径 */
  filePath?: string
  /** 错误信息 */
  error?: string
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
