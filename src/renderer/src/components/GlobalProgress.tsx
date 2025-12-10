/**
 * 全局进度条组件
 * 显示文档加载、模型下载、向量化等后台任务的进度
 * 位置：标题栏下方，全局可见
 */
import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { Progress, Typography, theme as antdTheme } from 'antd'
import {
  CloudDownloadOutlined,
  FileTextOutlined,
  ThunderboltOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined
} from '@ant-design/icons'

export interface ProgressInfo {
  stage: string
  percent: number
  error?: string
  taskType?: string
}

interface GlobalProgressProps {
  progress: ProgressInfo | null
}

/** 获取任务类型对应的图标 */
function getTaskIcon(taskType?: string, isError?: boolean): ReactElement {
  if (isError) {
    return <CloseCircleOutlined />
  }

  const type = taskType?.toUpperCase()
  if (type === 'COMPLETED') {
    return <CheckCircleOutlined />
  }
  if (type?.includes('MODEL')) {
    return <CloudDownloadOutlined />
  }
  if (type === 'DOCUMENT_PARSE') {
    return <FileTextOutlined />
  }
  if (type === 'INDEX_REBUILD' || type === 'EMBEDDING_GENERATION') {
    return <ThunderboltOutlined />
  }
  return <LoadingOutlined />
}

/** 获取任务类型对应的标题 */
function getTaskTitle(taskType?: string): string {
  if (!taskType) return '正在处理'
  const type = taskType.toUpperCase()
  if (type === 'COMPLETED') return '处理完成'
  if (type?.includes('MODEL')) return '正在下载模型'
  if (type === 'DOCUMENT_PARSE') return '正在解析文档'
  if (type === 'INDEX_REBUILD') return '正在重建索引'
  if (type === 'EMBEDDING_GENERATION') return '正在生成向量'
  if (type === 'ERROR') return '处理失败'
  return '正在处理'
}

/** 获取进度条颜色 */
function getProgressColor(token: ReturnType<typeof antdTheme.useToken>['token'], taskType?: string): string | { from: string; to: string } {
  const type = taskType?.toUpperCase()
  if (type === 'COMPLETED') {
    return '#52c41a' // 成功绿色
  }
  if (type?.includes('MODEL')) {
    return { from: token.colorInfo, to: '#3b82f6' } // 蓝色渐变
  }
  if (type === 'DOCUMENT_PARSE') {
    return { from: '#faad14', to: '#ffc107' } // 橙色渐变
  }
  if (type === 'INDEX_REBUILD' || type === 'EMBEDDING_GENERATION') {
    return { from: '#52c41a', to: '#87d068' } // 绿色渐变
  }
  return { from: token.colorPrimary, to: '#7c3aed' } // 紫色渐变
}

export function GlobalProgress({ progress }: GlobalProgressProps): ReactElement | null {
  const { token } = antdTheme.useToken()

  // 计算样式
  const styles = useMemo(() => {
    if (!progress) return null

    const isError = !!progress.error
    const isCompleted = progress.taskType?.toUpperCase() === 'COMPLETED'

    return {
      container: {
        background: isError
          ? `linear-gradient(90deg, rgba(255, 77, 79, 0.08) 0%, rgba(255, 77, 79, 0.02) 100%)`
          : isCompleted
            ? `linear-gradient(90deg, rgba(82, 196, 26, 0.08) 0%, rgba(82, 196, 26, 0.02) 100%)`
            : `linear-gradient(90deg, ${token.colorPrimaryBg} 0%, rgba(124, 58, 237, 0.02) 100%)`,
        borderBottom: `1px solid ${isError ? 'rgba(255, 77, 79, 0.2)' : isCompleted ? 'rgba(82, 196, 26, 0.2)' : token.colorBorderSecondary}`
      },
      icon: {
        color: isError ? token.colorError : isCompleted ? '#52c41a' : token.colorPrimary,
        fontSize: 14
      },
      title: {
        color: isError ? token.colorError : isCompleted ? '#52c41a' : token.colorPrimary
      },
      percent: {
        color: isError ? token.colorError : isCompleted ? '#52c41a' : token.colorTextSecondary
      }
    }
  }, [progress, token])

  // 无进度时不渲染
  if (!progress || !styles) {
    return null
  }

  const isError = !!progress.error
  const progressColor = isError ? token.colorError : getProgressColor(token, progress.taskType)

  return (
    <div
      className="px-4 py-2 flex items-center gap-3 transition-all duration-300 ease-in-out"
      style={styles.container}
    >
      {/* 图标 */}
      <span style={styles.icon} className="flex items-center">
        {getTaskIcon(progress.taskType, isError)}
      </span>

      {/* 标题和详情 */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <Typography.Text
            className="text-xs font-medium"
            style={styles.title}
          >
            {isError ? '处理失败' : getTaskTitle(progress.taskType)}
          </Typography.Text>
          <Typography.Text
            className="text-xs truncate"
            type="secondary"
            title={progress.stage}
            style={{ maxWidth: 300 }}
          >
            {progress.stage}
          </Typography.Text>
        </div>
      </div>

      {/* 进度条和百分比 */}
      <div className="flex items-center gap-2" style={{ width: 180 }}>
        <Progress
          percent={progress.percent}
          size="small"
          showInfo={false}
          status={isError ? 'exception' : 'active'}
          strokeColor={progressColor}
          style={{ flex: 1, margin: 0 }}
        />
        <Typography.Text
          className="text-xs font-mono"
          style={{ ...styles.percent, width: 36, textAlign: 'right' }}
        >
          {progress.percent}%
        </Typography.Text>
      </div>
    </div>
  )
}

export default GlobalProgress

