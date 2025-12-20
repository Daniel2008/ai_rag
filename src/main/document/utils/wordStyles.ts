import type { DocumentTheme } from '../types'

/** 主题配色方案 - 增强版 */
export const THEME_COLORS: Record<
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
export const FONTS = {
  title: '微软雅黑',
  heading: '微软雅黑',
  body: '宋体',
  english: 'Times New Roman',
  code: 'Consolas',
  quote: '楷体'
}
