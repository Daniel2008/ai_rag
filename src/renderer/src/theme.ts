import { theme as antdTheme, ThemeConfig } from 'antd'

export type ThemeMode = 'light' | 'dark'

// 现代化配色方案
const lightColors = {
  colorPrimary: '#4f46e5', // 靛蓝色主色调
  colorPrimaryBg: '#eef2ff',
  colorSuccess: '#10b981',
  colorWarning: '#f59e0b',
  colorError: '#ef4444',
  colorInfo: '#3b82f6',
  colorBgLayout: '#f8fafc',
  colorBgContainer: '#ffffff',
  colorBgElevated: '#ffffff',
  colorBorder: '#e2e8f0',
  colorBorderSecondary: '#f1f5f9',
  colorText: '#1e293b',
  colorTextSecondary: '#64748b',
  colorTextTertiary: '#94a3b8'
}

const darkColors = {
  colorPrimary: '#818cf8', // 更柔和的靛蓝色
  colorPrimaryBg: '#1e1b4b',
  colorSuccess: '#34d399',
  colorWarning: '#fbbf24',
  colorError: '#f87171',
  colorInfo: '#60a5fa',
  colorBgLayout: '#0f172a',
  colorBgContainer: '#1e293b',
  colorBgElevated: '#334155',
  colorBorder: '#334155',
  colorBorderSecondary: '#1e293b',
  colorText: '#f1f5f9',
  colorTextSecondary: '#94a3b8',
  colorTextTertiary: '#64748b'
}

export function getTheme(mode: ThemeMode): ThemeConfig {
  const algorithm = mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm
  const colors = mode === 'dark' ? darkColors : lightColors

  return {
    algorithm,
    token: {
      colorPrimary: colors.colorPrimary,
      colorPrimaryBg: colors.colorPrimaryBg,
      colorSuccess: colors.colorSuccess,
      colorWarning: colors.colorWarning,
      colorError: colors.colorError,
      colorInfo: colors.colorInfo,
      colorBgLayout: colors.colorBgLayout,
      colorBgContainer: colors.colorBgContainer,
      colorBgElevated: colors.colorBgElevated,
      colorBorder: colors.colorBorder,
      colorBorderSecondary: colors.colorBorderSecondary,
      colorText: colors.colorText,
      colorTextSecondary: colors.colorTextSecondary,
      colorTextTertiary: colors.colorTextTertiary,
      borderRadius: 12,
      borderRadiusLG: 16,
      borderRadiusSM: 8,
      controlOutline: 'transparent',
      fontFamily:
        "'Plus Jakarta Sans', 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      fontSize: 14,
      lineHeight: 1.6,
      motion: true
    },
    components: {
      Tag: {
        borderRadius: 6,
        colorBgContainer: mode === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.04)'
      },
      Card: {
        borderRadiusLG: 16,
        boxShadow: mode === 'dark' ? '0 4px 24px rgba(0,0,0,0.4)' : '0 4px 24px rgba(0,0,0,0.06)'
      },
      Button: {
        borderRadius: 10,
        controlHeight: 40,
        controlHeightSM: 32,
        controlHeightLG: 48,
        primaryShadow:
          mode === 'dark'
            ? '0 4px 12px rgba(129, 140, 248, 0.3)'
            : '0 4px 12px rgba(79, 70, 229, 0.25)'
      },
      Input: {
        borderRadius: 10,
        controlHeight: 40,
        colorBgContainer: mode === 'dark' ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.02)',
        hoverBorderColor: colors.colorPrimary
      },
      Select: {
        borderRadius: 10,
        controlHeight: 36
      },
      Modal: {
        borderRadiusLG: 20
      },
      Form: {
        controlHeight: 40
      },
      Segmented: {
        itemSelectedBg: colors.colorPrimary,
        itemSelectedColor: '#ffffff',
        borderRadius: 8
      },
      Collapse: {
        borderRadiusLG: 12,
        headerBg: 'transparent'
      },
      List: {
        itemPaddingSM: '12px 16px'
      },
      Message: {
        borderRadiusLG: 12
      },
      Tooltip: {
        borderRadius: 8
      }
    }
  }
}
