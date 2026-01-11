import { MessagePort } from 'worker_threads'
import { BaseProgressManager } from './baseProgressManager'
import { ProgressStatus, TaskType } from '../progressTypes'

export class LoadProgressManager extends BaseProgressManager {
    private currentStep = 0
    private totalSteps = 100 // 默认虚拟步数

    constructor(
        taskId: string,
        parentPort: MessagePort | null
    ) {
        // 这里的 TaskType 可能需要动态调整，但通常是 MODEL_DOWNLOAD 或者 PROCESSING
        // 实际上 Load 往往发生在 MODEL_DOWNLOAD 之后，作为 PROCESSING 的一部分，
        // 或者它自己就是 MODEL_DOWNLOAD 的最后阶段
        super(taskId, TaskType.MODEL_DOWNLOAD, parentPort)
    }

    public calculateProgress(): number {
        return Math.round((this.currentStep / this.totalSteps) * 100)
    }

    public reportProgress(percent: number, message: string) {
        this.currentStep = Math.max(0, Math.min(100, percent))
        this.sendUpdate(ProgressStatus.PROCESSING, message)
    }

    public finish(message: string = '模型加载完成') {
        this.currentStep = 100
        this.sendUpdate(ProgressStatus.COMPLETED, message)
    }
}
