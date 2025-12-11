/**
 * 全局进度状态管理 Hook
 * 监听文档处理、模型下载、向量化等后台任务的进度
 *
 * 优化要点：
 * 1. 关键状态变化（开始、完成、错误）立即显示
 * 2. 中间进度按批次更新，避免频繁刷新
 * 3. 阶段切换时立即更新以保证用户感知
 */
import { useCallback, useEffect, useRef, useState } from 'react'

/** 统一进度状态接口 */
export interface ProgressInfo {
  stage: string
  percent: number
  error?: string
  taskType?: string
}

/** 进度更新的批处理配置 */
const BATCH_INTERVAL_MS = 300 // 批处理间隔（减少以提高响应性）
const MIN_PERCENT_CHANGE = 2 // 最小百分比变化（降低以更平滑）
const MIN_TIME_INTERVAL_MS = 150 // 最小时间间隔（减少以提高响应性）
const COMPLETION_DISPLAY_MS = 2000 // 完成状态显示时长（增加以便用户注意）
const ERROR_DISPLAY_MS = 4000 // 错误状态显示时长（增加以便用户查看）

/** 阶段描述优化映射 */
const STAGE_DESCRIPTIONS: Record<string, string> = {
  // 模型下载相关
  '正在加载模型': '正在初始化嵌入模型...',
  '模型已就绪': '嵌入模型就绪',
  '模型加载完成': '嵌入模型加载完成',
  
  // 文档处理相关
  '正在索引文档...': '正在将文档添加到知识库...',
  '索引完成': '文档已添加到知识库',
  '索引完成（已重建）': '知识库索引已重建',
  
  // 通用
  '处理完成': '✓ 处理完成',
  '重建完成': '✓ 索引重建完成'
}

/** 优化阶段描述 */
function optimizeStageDescription(stage: string): string {
  // 首先检查精确匹配
  if (STAGE_DESCRIPTIONS[stage]) {
    return STAGE_DESCRIPTIONS[stage]
  }
  
  // 处理动态内容（如包含文件名或数量的描述）
  // 例如：「正在解析文档 (1/3)...」保持原样
  // 例如：「文档解析完成，共 5 个片段」保持原样
  
  // 简化一些冗长的描述
  if (stage.startsWith('正在生成向量') && stage.includes('/')) {
    // 保持格式但简化
    return stage
  }
  
  if (stage.startsWith('下载中:')) {
    // 模型下载进度，保持原样
    return stage
  }
  
  return stage
}

export interface UseProgressReturn {
  /** 当前进度（null 表示没有任务） */
  progress: ProgressInfo | null
  /** 手动清除进度 */
  clearProgress: () => void
}

export function useProgress(): UseProgressReturn {
  const [progress, setProgress] = useState<ProgressInfo | null>(null)

  // 批处理相关的 ref
  const lastDisplayedRef = useRef<{
    time: number
    percent: number
    stage: string
    taskType?: string
  }>({ time: 0, percent: -1, stage: '' })
  const pendingProgressRef = useRef<ProgressInfo | null>(null)
  const batchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const clearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 清理所有定时器
  const clearAllTimers = useCallback(() => {
    if (batchTimerRef.current) {
      clearTimeout(batchTimerRef.current)
      batchTimerRef.current = null
    }
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
      clearTimerRef.current = null
    }
  }, [])

  // 立即更新进度
  const updateProgressImmediate = useCallback((newProgress: ProgressInfo | null) => {
    clearAllTimers()
    pendingProgressRef.current = null

    const now = Date.now()
    lastDisplayedRef.current = {
      time: now,
      percent: newProgress?.percent || 0,
      stage: newProgress?.stage || '',
      taskType: newProgress?.taskType
    }

    setProgress(newProgress)
  }, [clearAllTimers])

  // 批量更新进度
  const updateProgressBatched = useCallback((newProgress: ProgressInfo | null) => {
    if (!newProgress) {
      updateProgressImmediate(null)
      return
    }

    const now = Date.now()

    // 错误状态或完成状态立即更新
    if (newProgress.error || newProgress.percent === 100) {
      updateProgressImmediate(newProgress)
      return
    }

    // 终止状态立即更新
    const isTerminalState = newProgress.taskType?.toUpperCase() === 'COMPLETED'
    if (isTerminalState) {
      updateProgressImmediate(newProgress)
      return
    }

    const newPercent = Math.max(0, Math.min(100, newProgress.percent || 0))
    const lastDisplayed = lastDisplayedRef.current
    const timeSinceLastUpdate = now - lastDisplayed.time
    const percentChange = Math.abs(newPercent - lastDisplayed.percent)
    const stageChanged = newProgress.stage !== lastDisplayed.stage
    const taskTypeChanged = newProgress.taskType !== lastDisplayed.taskType

    // 首次显示立即更新
    if (lastDisplayed.percent < 0) {
      updateProgressImmediate({ ...newProgress, percent: newPercent })
      return
    }

    // 判断是否应该立即更新
    const shouldUpdateNow =
      (percentChange >= MIN_PERCENT_CHANGE && timeSinceLastUpdate >= MIN_TIME_INTERVAL_MS) ||
      stageChanged ||
      taskTypeChanged ||
      timeSinceLastUpdate >= BATCH_INTERVAL_MS * 2

    if (shouldUpdateNow) {
      updateProgressImmediate({ ...newProgress, percent: newPercent })
    } else {
      // 保存待处理的更新
      pendingProgressRef.current = { ...newProgress, percent: newPercent }

      if (!batchTimerRef.current) {
        const delay = Math.max(0, Math.min(BATCH_INTERVAL_MS, BATCH_INTERVAL_MS - timeSinceLastUpdate))

        batchTimerRef.current = setTimeout(() => {
          batchTimerRef.current = null

          if (pendingProgressRef.current) {
            const pending = pendingProgressRef.current
            pendingProgressRef.current = null

            const currentDisplayed = lastDisplayedRef.current
            const finalPercent = pending.percent || 0
            const finalPercentChange = Math.abs(finalPercent - currentDisplayed.percent)
            const finalStageChanged = pending.stage !== currentDisplayed.stage

            if (finalPercentChange >= 1 || finalStageChanged) {
              updateProgressImmediate(pending)
            }
          }
        }, delay)
      }
    }
  }, [updateProgressImmediate])

  // 延迟清除进度
  const scheduleClear = useCallback((delayMs: number) => {
    if (clearTimerRef.current) {
      clearTimeout(clearTimerRef.current)
    }
    clearTimerRef.current = setTimeout(() => {
      clearTimerRef.current = null
      updateProgressImmediate(null)
      // 重置 lastDisplayedRef 以便下次可以立即显示
      lastDisplayedRef.current = { time: 0, percent: -1, stage: '' }
    }, delayMs)
  }, [updateProgressImmediate])

  // 手动清除进度
  const clearProgress = useCallback(() => {
    updateProgressImmediate(null)
    lastDisplayedRef.current = { time: 0, percent: -1, stage: '' }
  }, [updateProgressImmediate])

  // 监听进度事件
  useEffect(() => {
    // 检查 window.api 是否已初始化
    if (!window.api) {
      console.warn('[useProgress] window.api is not available yet')
      return
    }

    // 监听文档处理进度
    if (typeof window.api.onProcessProgress === 'function') {
      window.api.onProcessProgress((progressData) => {
        // 优化阶段描述
        const optimizedStage = optimizeStageDescription(progressData.stage)
        
        const newProgress: ProgressInfo = {
          ...progressData,
          stage: optimizedStage,
          taskType: progressData.taskType || 'index_rebuild'
        }

        // 错误状态立即显示
        if (progressData.error) {
          updateProgressImmediate({
            ...newProgress,
            taskType: 'error'
          })
          scheduleClear(ERROR_DISPLAY_MS)
          return
        }
        
        // 完成状态（100% 或 taskType 为 completed）
        if (progressData.percent >= 100 || progressData.taskType?.toLowerCase() === 'completed') {
          updateProgressImmediate({
            ...newProgress,
            stage: optimizedStage.includes('✓') ? optimizedStage : '✓ 处理完成',
            percent: 100,
            taskType: 'completed'
          })
          scheduleClear(COMPLETION_DISPLAY_MS)
          return
        }
        
        // 开始状态（0-5%）立即显示，让用户知道任务已开始
        if (progressData.percent <= 5 && lastDisplayedRef.current.percent <= 0) {
          updateProgressImmediate(newProgress)
          return
        }
        
        // 中间进度批量更新
        updateProgressBatched(newProgress)
      })
    }

    // 监听嵌入模型进度
    if (typeof window.api.onEmbeddingProgress === 'function') {
      window.api.onEmbeddingProgress((progressData) => {
        const rawStage = progressData.stage || progressData.message || '正在处理模型...'
        const stage = optimizeStageDescription(rawStage)
        const taskType = progressData.taskType || 'model_download'
        const percent = progressData.percent || progressData.progress || 0
        const isError = progressData.status === 'error'
        const isCompleted = progressData.status === 'completed' || progressData.status === 'ready'

        const newProgress: ProgressInfo = {
          stage: isCompleted ? '✓ 嵌入模型就绪' : stage,
          percent: isCompleted ? 100 : Math.max(0, Math.min(100, percent)),
          error: isError ? progressData.message : undefined,
          taskType: isCompleted ? 'completed' : taskType
        }

        // 错误状态立即显示
        if (isError) {
          updateProgressImmediate({
            ...newProgress,
            taskType: 'error'
          })
          scheduleClear(ERROR_DISPLAY_MS)
          return
        }
        
        // 完成状态立即显示
        if (isCompleted) {
          updateProgressImmediate(newProgress)
          scheduleClear(COMPLETION_DISPLAY_MS)
          return
        }
        
        // 开始下载时立即显示
        if (percent <= 5 && lastDisplayedRef.current.percent <= 0) {
          updateProgressImmediate(newProgress)
          return
        }
        
        // 中间进度批量更新
        updateProgressBatched(newProgress)
      })
    }

    return () => {
      clearAllTimers()
      if (window.api) {
        if (typeof window.api.removeProcessProgressListener === 'function') {
          window.api.removeProcessProgressListener()
        }
        if (typeof window.api.removeEmbeddingProgressListener === 'function') {
          window.api.removeEmbeddingProgressListener()
        }
      }
    }
  }, [updateProgressBatched, updateProgressImmediate, scheduleClear, clearAllTimers])

  return {
    progress,
    clearProgress
  }
}

