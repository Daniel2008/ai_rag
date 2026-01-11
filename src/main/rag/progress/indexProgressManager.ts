import { MessagePort, parentPort as defaultParentPort } from 'worker_threads'
import { BaseProgressManager } from './baseProgressManager'
import { ProgressStatus, TaskType } from '../progressTypes'

export class IndexProgressManager extends BaseProgressManager {
    private parentStartProgress = 0
    private parentEndProgress = 100
    // @ts-ignore - unused property
    private currentCount = 0

    constructor(
        taskId: string,
        taskType: TaskType,
        parentPort: MessagePort | null = defaultParentPort, // 默认使用全局 parentPort
        onProgress?: (message: any) => void
    ) {
        super(taskId, taskType, parentPort, onProgress)
        // 索引任务通常更慢，增加节流时间
        // @ts-ignore - overriding protected property
        this.THROTTLE_INTERVAL = 300
    }

    public setRange(start: number, end: number) {
        this.parentStartProgress = start
        this.parentEndProgress = end
    }

    public setTotal(total: number) {
        // 预留接口
    }

    public increment(amount: number = 1) {
        this.currentCount += amount
    }

    public update(current: number, total: number, message: string) {
        this.currentCount = current

        // 如果设置了范围，计算相对进度并映射到全局范围
        let localProgress = 0
        if (total > 0) {
            localProgress = (current / total) * 100
        }

        // 映射到父范围: start + (local% * (end - start))
        const range = this.parentEndProgress - this.parentStartProgress
        const globalProgress = this.parentStartProgress + (localProgress / 100) * range

        // 保存计算出的全局进度供 calculateProgress 使用
        this.lastCalculatedGlobalProgress = globalProgress

        this.sendUpdate(ProgressStatus.PROCESSING, message, {
            processedCount: current,
            totalCount: total
        })
    }

    private lastCalculatedGlobalProgress = 0

    public calculateProgress(): number {
        return Math.round(this.lastCalculatedGlobalProgress)
    }
}
