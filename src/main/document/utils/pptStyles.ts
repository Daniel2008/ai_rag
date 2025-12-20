import type { DocumentTheme } from '../types'

/** 主题配色方案 - 增强版 */
export const THEME_COLORS: Record<
  DocumentTheme,
  {
    primary: string
    secondary: string
    accent: string
    background: string
    text: string
    lightText: string
    gradient: { start: string; end: string }
    highlight: string
  }
> = {
  professional: {
    primary: '2B579A',
    secondary: '4472C4',
    accent: '5B9BD5',
    background: 'FFFFFF',
    text: '333333',
    lightText: '666666',
    gradient: { start: '2B579A', end: '4472C4' },
    highlight: 'FFC107'
  },
  modern: {
    primary: '1A1A2E',
    secondary: '16213E',
    accent: '0F3460',
    background: 'F8F9FA',
    text: '1A1A2E',
    lightText: '495057',
    gradient: { start: '1A1A2E', end: '16213E' },
    highlight: 'E94560'
  },
  simple: {
    primary: '333333',
    secondary: '666666',
    accent: '0066CC',
    background: 'FFFFFF',
    text: '333333',
    lightText: '888888',
    gradient: { start: '333333', end: '555555' },
    highlight: '00A8E8'
  },
  creative: {
    primary: '6C5CE7',
    secondary: 'A29BFE',
    accent: 'FD79A8',
    background: 'FAFAFA',
    text: '2D3436',
    lightText: '636E72',
    gradient: { start: '6C5CE7', end: 'A29BFE' },
    highlight: 'FDCB6E'
  }
}

/** 字体配置 - 增强版 */
export const FONTS = {
  title: '微软雅黑',
  body: '微软雅黑',
  english: 'Arial',
  code: 'Consolas',
  quote: '楷体'
}

/** 内容分页配置 */
export const PAGE_CONFIG = {
  maxParagraphsPerSlide: 2,
  maxBulletsPerSlide: 6,
  maxCharsPerParagraph: 200,
  maxCharsPerBullet: 80
}
