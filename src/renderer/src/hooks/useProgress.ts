/**
 * 全局进度状态管理 Hook
 * 监听文档处理、模型下载、向量化等后台任务的进度
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
const BATCH_INTERVAL_MS = 400 // 批处理间隔
const MIN_PERCENT_CHANGE = 3 // 最小百分比变化
const MIN_TIME_INTERVAL_MS = 200 // 最小时间间隔
const COMPLETION_DISPLAY_MS = 1500 // 完成状态显示时长
const ERROR_DISPLAY_MS = 3000 // 错误状态显示时长

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
    // 监听文档处理进度
    window.api.onProcessProgress((progressData) => {
      const newProgress: ProgressInfo = {
        ...progressData,
        taskType: progressData.taskType || 'INDEX_REBUILD'
      }

      if (progressData.error) {
        updateProgressImmediate(newProgress)
        scheduleClear(ERROR_DISPLAY_MS)
      } else if (progressData.percent === 100) {
        updateProgressImmediate({
          ...newProgress,
          stage: '处理完成',
          taskType: 'COMPLETED'
        })
        scheduleClear(COMPLETION_DISPLAY_MS)
      } else {
        updateProgressBatched(newProgress)
      }
    })

    // 监听嵌入模型进度
    window.api.onEmbeddingProgress((progressData) => {
      const stage = progressData.stage || progressData.message || '正在处理模型...'
      const taskType = progressData.taskType || 'MODEL_DOWNLOAD'
      const percent = progressData.percent || progressData.progress || 0
      const isError = progressData.status === 'error'
      const isCompleted = progressData.status === 'completed' || progressData.status === 'ready'

      const newProgress: ProgressInfo = {
        stage: isCompleted ? '模型就绪' : stage,
        percent: isCompleted ? 100 : Math.max(0, Math.min(100, percent)),
        error: isError ? progressData.message : undefined,
        taskType: isCompleted ? 'COMPLETED' : taskType
      }

      if (isError) {
        updateProgressImmediate(newProgress)
        scheduleClear(ERROR_DISPLAY_MS)
      } else if (isCompleted) {
        updateProgressImmediate(newProgress)
        scheduleClear(COMPLETION_DISPLAY_MS)
      } else {
        updateProgressBatched(newProgress)
      }
    })

    return () => {
      clearAllTimers()
      window.api.removeProcessProgressListener()
      window.api.removeEmbeddingProgressListener()
    }
  }, [updateProgressBatched, updateProgressImmediate, scheduleClear, clearAllTimers])

  return {
    progress,
    clearProgress
  }
}

