import { MessagePort } from 'worker_threads'
import { ProgressMessage as IProgressPayload, ProgressStatus, TaskType } from '../progressTypes'

// 定义 Worker 消息结构
export interface WorkerMessage {
    id: string
    type: 'progress'
    payload: IProgressPayload & {
        // 兼容字段，前端可能还在用
        stage?: string
        error?: string
        file?: string
        fileProgress?: number
        mirror?: string
    }
}

export interface IProgressManager {
    sendUpdate(status: ProgressStatus, message: string, payload?: Partial<IProgressPayload>): void
    calculateProgress(): number
}

export abstract class BaseProgressManager implements IProgressManager {
    protected lastReportedProgress = 0
    protected progressUpdateThrottle = 0

    // 配置参数
    protected readonly THROTTLE_INTERVAL = 200 // 默认200ms节流
    protected readonly MIN_PROGRESS_CHANGE = 1 // 最小进度变化1%

    constructor(
        protected taskId: string,
        protected taskType: TaskType,
        protected parentPort: MessagePort | null,
        protected onProgress?: (message: WorkerMessage['payload']) => void
    ) { }

    /**
     * 计算当前进度的抽象方法，由子类实现
     */
    public abstract calculateProgress(): number

    /**
     * 发送进度更新
     */
    public sendUpdate(
        status: ProgressStatus,
        message: string,
        extraPayload?: Partial<WorkerMessage['payload']>
    ) {
        const now = Date.now()
        const currentProgress = this.calculateProgress()

        // 状态检查
        const isCompleted = status === ProgressStatus.COMPLETED
        const isError = status === ProgressStatus.ERROR

        // 确保进度单调递增（除非是错误状态，或者显式重置）
        const rawFinalProgress = Math.max(currentProgress, this.lastReportedProgress)
        const finalProgress = isCompleted ? 100 : Math.min(99, rawFinalProgress)

        // 检查是否需要触发更新
        const progressChanged = finalProgress - this.lastReportedProgress >= this.MIN_PROGRESS_CHANGE
        const timeElapsed = now - this.progressUpdateThrottle >= this.THROTTLE_INTERVAL

        // 强制更新条件：
        // 1. 完成或错误状态
        // 2. 进度变化超过阈值
        // 3. 超过节流时间间隔
        const shouldUpdate = isCompleted || isError || progressChanged || timeElapsed

        if (!shouldUpdate) {
            return
        }

        // 更新状态
        this.lastReportedProgress = finalProgress
        this.progressUpdateThrottle = now

        // 构建消息 payload
        const payload: WorkerMessage['payload'] = {
            taskType: this.taskType,
            status,
            progress: finalProgress,
            message,
            // 兼容字段
            stage: message,
            error: isError ? message : undefined,
            ...extraPayload
        }

        const workerMessage: WorkerMessage = {
            id: this.taskId,
            type: 'progress',
            payload
        }

        if (this.parentPort) {
            this.parentPort.postMessage(workerMessage)
        }

        // 如果有回调，也调用回调 (主要用于主进程中的进度管理)
        if (this.onProgress) {
            this.onProgress(payload)
        }
    }

    /**
     * 强制重置进度状态（用于重新开始任务）
     */
    public reset() {
        this.lastReportedProgress = 0
        this.progressUpdateThrottle = 0
    }
}
