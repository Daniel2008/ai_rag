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

/** 任务类型枚举（与后端保持一致） */
const TaskTypeMap = {
  MODEL_DOWNLOAD: 'model_download',
  DOCUMENT_PARSE: 'document_parse',
  DOCUMENT_SPLIT: 'document_split',
  EMBEDDING_GENERATION: 'embedding_generation',
  INDEX_REBUILD: 'index_rebuild',
  KNOWLEDGE_BASE_BUILD: 'knowledge_base_build',
  COMPLETED: 'completed',
  ERROR: 'error'
} as const

/** 获取任务类型对应的图标 */
function getTaskIcon(taskType?: string, isError?: boolean): ReactElement {
  if (isError) {
    return <CloseCircleOutlined />
  }

  const type = taskType?.toLowerCase()

  switch (type) {
    case 'completed':
      return <CheckCircleOutlined />
    case TaskTypeMap.MODEL_DOWNLOAD:
    case 'downloading':
      return <CloudDownloadOutlined />
    case TaskTypeMap.DOCUMENT_PARSE:
    case TaskTypeMap.DOCUMENT_SPLIT:
      return <FileTextOutlined />
    case TaskTypeMap.EMBEDDING_GENERATION:
    case TaskTypeMap.INDEX_REBUILD:
    case TaskTypeMap.KNOWLEDGE_BASE_BUILD:
      return <ThunderboltOutlined />
    default:
      // 兼容旧格式（大写）和包含关键字的情况
      if (type?.includes('model') || type?.includes('download')) {
        return <CloudDownloadOutlined />
      }
      if (type?.includes('document') || type?.includes('parse')) {
        return <FileTextOutlined />
      }
      if (type?.includes('embed') || type?.includes('index') || type?.includes('vector')) {
        return <ThunderboltOutlined />
      }
      return <LoadingOutlined />
  }
}

/** 任务标题映射 */
const TASK_TITLES: Record<string, string> = {
  [TaskTypeMap.MODEL_DOWNLOAD]: '下载嵌入模型',
  [TaskTypeMap.DOCUMENT_PARSE]: '解析文档',
  [TaskTypeMap.DOCUMENT_SPLIT]: '分割文档',
  [TaskTypeMap.EMBEDDING_GENERATION]: '生成向量',
  [TaskTypeMap.INDEX_REBUILD]: '重建索引',
  [TaskTypeMap.KNOWLEDGE_BASE_BUILD]: '构建知识库',
  completed: '处理完成',
  error: '处理失败',
  downloading: '下载模型'
}

/** 获取任务类型对应的标题 */
function getTaskTitle(taskType?: string): string {
  if (!taskType) return '正在处理'

  const type = taskType.toLowerCase()

  // 精确匹配
  if (TASK_TITLES[type]) {
    return TASK_TITLES[type]
  }

  // 模糊匹配（兼容旧格式）
  if (type.includes('model') || type.includes('download')) {
    return '下载嵌入模型'
  }
  if (type.includes('parse')) {
    return '解析文档'
  }
  if (type.includes('split')) {
    return '分割文档'
  }
  if (type.includes('embed') || type.includes('vector')) {
    return '生成向量'
  }
  if (type.includes('index') || type.includes('rebuild')) {
    return '重建索引'
  }
  if (type.includes('knowledge')) {
    return '构建知识库'
  }

  return '正在处理'
}

/** 获取进度条颜色 */
function getProgressColor(
  token: ReturnType<typeof antdTheme.useToken>['token'],
  taskType?: string
): string | { from: string; to: string } {
  const type = taskType?.toLowerCase()

  // 完成状态：绿色
  if (type === 'completed') {
    return '#52c41a'
  }

  // 模型下载：蓝色渐变
  if (
    type === TaskTypeMap.MODEL_DOWNLOAD ||
    type?.includes('model') ||
    type?.includes('download')
  ) {
    return { from: token.colorInfo, to: '#3b82f6' }
  }

  // 文档解析/分割：橙色渐变
  if (
    type === TaskTypeMap.DOCUMENT_PARSE ||
    type === TaskTypeMap.DOCUMENT_SPLIT ||
    type?.includes('parse') ||
    type?.includes('split')
  ) {
    return { from: '#faad14', to: '#ffc107' }
  }

  // 向量生成/索引重建/知识库构建：绿色渐变
  if (
    type === TaskTypeMap.EMBEDDING_GENERATION ||
    type === TaskTypeMap.INDEX_REBUILD ||
    type === TaskTypeMap.KNOWLEDGE_BASE_BUILD ||
    type?.includes('embed') ||
    type?.includes('index') ||
    type?.includes('vector') ||
    type?.includes('knowledge')
  ) {
    return { from: '#52c41a', to: '#87d068' }
  }

  // 默认：紫色渐变
  return { from: token.colorPrimary, to: '#7c3aed' }
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
          <Typography.Text className="text-xs font-medium" style={styles.title}>
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
