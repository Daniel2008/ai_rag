import { MessagePort } from 'worker_threads'
import { BaseProgressManager } from './baseProgressManager'
import { ProgressStatus, TaskType } from '../progressTypes'
import { extractFileBaseName, getDisplayFileName } from '../modelUtils'

export interface FileDownloadState {
    loaded: number
    total: number
    completed: boolean
}

export class DownloadProgressManager extends BaseProgressManager {
    private fileStates = new Map<string, FileDownloadState>()
    private fileKeyAliases = new Map<string, string>()

    constructor(
        taskId: string,
        taskType: TaskType,
        parentPort: MessagePort | null
    ) {
        super(taskId, taskType, parentPort)
    }

    public getFileStates() {
        return this.fileStates
    }

    private resolveFileKey(input: string): string {
        if (this.fileStates.has(input)) return input
        const cached = this.fileKeyAliases.get(input)
        if (cached && this.fileStates.has(cached)) return cached

        const base = extractFileBaseName(input)
        const matches: string[] = []
        for (const key of this.fileStates.keys()) {
            if (extractFileBaseName(key) === base) {
                matches.push(key)
            }
        }

        if (matches.length === 0) return input
        const direct = matches.find((k) => k.endsWith(`/${input}`))
        const chosen = direct ?? matches[0]!
        this.fileKeyAliases.set(input, chosen)
        return chosen
    }

    public calculateProgress(): number {
        if (this.fileStates.size === 0) return 0

        let knownLoaded = 0
        let knownTotal = 0
        let knownCount = 0
        let unknownCount = 0
        let unknownCompleted = 0
        let completedFiles = 0

        for (const [, state] of this.fileStates.entries()) {
            if (state.completed) completedFiles++

            if (state.total > 0) {
                knownCount++
                knownTotal += state.total
                knownLoaded += Math.min(state.loaded, state.total)
            } else {
                unknownCount++
                if (state.completed) unknownCompleted++
            }
        }

        // 计算完成百分比
        let progress = 0

        if (knownTotal <= 0) {
            progress = (completedFiles / this.fileStates.size) * 100
        } else if (unknownCount === 0) {
            progress = (knownLoaded / knownTotal) * 100
        } else {
            const avgKnownSize = knownCount > 0 ? knownTotal / knownCount : knownTotal
            const estimatedTotal = knownTotal + avgKnownSize * unknownCount
            const estimatedLoaded = knownLoaded + avgKnownSize * unknownCompleted
            progress = (estimatedLoaded / Math.max(estimatedTotal, 1)) * 100
        }

        return Math.round(progress)
    }

    public reportFileProgress(
        filePath: string,
        status: ProgressStatus,
        message: string,
        bytesLoaded?: number,
        bytesTotal?: number
    ) {
        // 尝试解析文件名
        const resolvedPath = this.resolveFileKey(filePath)

        // 初始化或更新文件状态
        if (!this.fileStates.has(resolvedPath)) {
            this.fileStates.set(resolvedPath, {
                loaded: bytesLoaded ?? 0,
                total: bytesTotal ?? 0,
                completed: status === ProgressStatus.COMPLETED || status === ProgressStatus.READY
            })
        }

        const state = this.fileStates.get(resolvedPath)!

        if (bytesTotal !== undefined) state.total = bytesTotal
        if (bytesLoaded !== undefined) state.loaded = bytesLoaded
        if (status === ProgressStatus.COMPLETED) {
            state.completed = true
            state.loaded = state.total || state.loaded
        }

        // 计算单个文件的进度用于展示
        const fileProgress = state.total > 0 ? state.loaded / state.total : (state.completed ? 1 : 0)

        this.sendUpdate(status, message, {
            file: resolvedPath,
            fileName: getDisplayFileName(resolvedPath),
            fileProgress: Math.min(1, Math.max(0, fileProgress))
        })
    }

    // 兼容 Transformers.js 的回调
    public customProgressCallback = (progress: Record<string, unknown>) => {
        const status = typeof progress.status === 'string' ? progress.status : ''
        // 处理文件名逻辑 (同旧版)
        const rawFile =
            typeof progress.file === 'string'
                ? progress.file
                : typeof progress.name === 'string'
                    ? progress.name
                    : typeof progress.url === 'string'
                        ? progress.url
                        : undefined

        if (!rawFile) return

        const loaded = Number(progress.loaded) || 0
        const total = Number(progress.total) || 0

        switch (status) {
            case 'initiate':
                this.reportFileProgress(rawFile, ProgressStatus.DOWNLOADING, `开始下载: ${getDisplayFileName(rawFile)}`, 0, total)
                break
            case 'progress':
            case 'download': {
                const loadedMB = (loaded / (1024 * 1024)).toFixed(2)
                const totalMB = total > 0 ? (total / (1024 * 1024)).toFixed(2) : '?'
                const percent = total > 0 ? ((loaded / total) * 100).toFixed(1) : '0'
                const msg = `下载中: ${getDisplayFileName(rawFile)} (${percent}%, ${loadedMB}MB / ${totalMB}MB)`
                this.reportFileProgress(rawFile, ProgressStatus.DOWNLOADING, msg, loaded, total)
                break
            }
            case 'done':
                this.reportFileProgress(rawFile, ProgressStatus.DOWNLOADING, `下载完成: ${getDisplayFileName(rawFile)}`, total, total)
                break
        }
    }
}
