/**
 * 内存监控工具
 */

import { RAG_CONFIG } from './config'
import { logInfo, logWarn, logError } from './logger'

interface MemoryStats {
  heapUsed: number
  heapTotal: number
  rss: number
  external: number
  timestamp: number
}

class MemoryMonitor {
  private statsHistory: MemoryStats[] = []
  private maxHistorySize = 100
  private warningThresholdMB: number
  private checkInterval: NodeJS.Timeout | null = null
  private isMonitoring = false

  constructor() {
    this.warningThresholdMB = RAG_CONFIG.MEMORY.WARNING_THRESHOLD_MB
  }

  /**
   * 获取当前内存使用情况
   */
  getCurrentMemory(): MemoryStats {
    const usage = process.memoryUsage()
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      rss: usage.rss,
      external: usage.external,
      timestamp: Date.now()
    }
  }

  /**
   * 获取内存使用情况（MB）
   */
  getMemoryInMB(): {
    heapUsed: number
    heapTotal: number
    rss: number
    external: number
  } {
    const stats = this.getCurrentMemory()
    const mb = 1024 * 1024
    return {
      heapUsed: Math.round((stats.heapUsed / mb) * 100) / 100,
      heapTotal: Math.round((stats.heapTotal / mb) * 100) / 100,
      rss: Math.round((stats.rss / mb) * 100) / 100,
      external: Math.round((stats.external / mb) * 100) / 100
    }
  }

  /**
   * 检查内存使用是否超过阈值
   */
  checkMemoryThreshold(): boolean {
    const memoryMB = this.getMemoryInMB()
    const totalUsed = memoryMB.heapUsed + memoryMB.external

    if (totalUsed > this.warningThresholdMB) {
      logWarn(
        `内存使用过高: ${totalUsed.toFixed(2)} MB (阈值: ${this.warningThresholdMB} MB)`,
        'MemoryMonitor',
        { ...memoryMB, totalUsed }
      )
      return true
    }

    return false
  }

  /**
   * 开始监控内存
   */
  startMonitoring(intervalMs: number = 60000): void {
    if (this.isMonitoring) {
      return
    }

    this.isMonitoring = true
    this.checkInterval = setInterval(() => {
      const stats = this.getCurrentMemory()
      this.statsHistory.push(stats)
      
      // 限制历史记录大小
      if (this.statsHistory.length > this.maxHistorySize) {
        this.statsHistory.shift()
      }

      // 检查阈值
      this.checkMemoryThreshold()
    }, intervalMs)
  }

  /**
   * 停止监控
   */
  stopMonitoring(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }
    this.isMonitoring = false
  }

  /**
   * 获取内存历史统计
   */
  getMemoryHistory(): MemoryStats[] {
    return [...this.statsHistory]
  }

  /**
   * 获取内存使用趋势
   */
  getMemoryTrend(windowMs: number = 300000): {
    avg: number
    max: number
    min: number
    current: number
  } {
    const now = Date.now()
    const window = this.statsHistory.filter(
      stat => now - stat.timestamp <= windowMs
    )

    if (window.length === 0) {
      const current = this.getCurrentMemory()
      const currentMB = (current.heapUsed + current.external) / (1024 * 1024)
      return {
        avg: currentMB,
        max: currentMB,
        min: currentMB,
        current: currentMB
      }
    }

    const values = window.map(
      stat => (stat.heapUsed + stat.external) / (1024 * 1024)
    )
    const current = this.getCurrentMemory()
    const currentMB = (current.heapUsed + current.external) / (1024 * 1024)

    return {
      avg: values.reduce((a, b) => a + b, 0) / values.length,
      max: Math.max(...values),
      min: Math.min(...values),
      current: currentMB
    }
  }

  /**
   * 尝试强制垃圾回收（如果可用）
   */
  tryGC(): void {
    if (global.gc) {
      try {
        global.gc()
        logInfo('执行了垃圾回收', 'MemoryMonitor')
      } catch (error) {
        logError('垃圾回收失败', 'MemoryMonitor', undefined, error as Error)
      }
    } else {
      logWarn('垃圾回收不可用，使用 --expose-gc 标志运行 Node.js', 'MemoryMonitor')
    }
  }

  /**
   * 检查结果数量是否会导致内存问题
   */
  checkResultCount(count: number): boolean {
    const maxResults = RAG_CONFIG.MEMORY.MAX_RESULTS_IN_MEMORY
    if (count > maxResults) {
      logWarn(
        `结果数量 ${count} 超过建议的最大值 ${maxResults}，可能导致内存问题`,
        'MemoryMonitor',
        { count, maxResults }
      )
      return false
    }
    return true
  }
}

// 导出单例实例
export const memoryMonitor = new MemoryMonitor()

// 在应用启动时开始监控
if (typeof process !== 'undefined') {
  // 延迟启动，避免在初始化时占用资源
  setTimeout(() => {
    memoryMonitor.startMonitoring(60000) // 每分钟检查一次
  }, 5000)
}

