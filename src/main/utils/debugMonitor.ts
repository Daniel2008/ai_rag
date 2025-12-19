import { logInfo, logWarn, logError, logDebug } from './logger'
import { getSettings } from '../settings'
import { memoryMonitor } from './memoryMonitor'

export interface PerformanceMetric {
  name: string
  duration: number
  timestamp: number
  metadata?: Record<string, any>
}

export interface DebugInfo {
  timestamp: number
  system: {
    platform: string
    arch: string
    nodeVersion: string
    electronVersion?: string
    memory: {
      used: number
      total: number
      percentage: number
    }
  }
  app: {
    version: string
    settings: any
    uptime: number
  }
  rag: {
    docCount?: number
    cacheStats?: any
    embeddingsReady?: boolean
  }
  performance: PerformanceMetric[]
  errors: ErrorInfo[]
}

export interface ErrorInfo {
  message: string
  stack?: string
  timestamp: number
  context?: string
  module?: string
}

/**
 * 调试和性能监控器
 */
export class DebugMonitor {
  private static instance: DebugMonitor
  private metrics: PerformanceMetric[] = []
  private errors: ErrorInfo[] = []
  private enabled: boolean = false
  private maxMetrics: number = 100
  private maxErrors: number = 50
  private startTime: number = Date.now()

  private constructor() {
    // 私有构造函数，确保单例
  }

  static getInstance(): DebugMonitor {
    if (!DebugMonitor.instance) {
      DebugMonitor.instance = new DebugMonitor()
    }
    return DebugMonitor.instance
  }

  /**
   * 启用调试模式
   */
  enable(): void {
    this.enabled = true
    this.startTime = Date.now()
    logInfo('调试监控已启用', 'DebugMonitor')
  }

  /**
   * 禁用调试模式
   */
  disable(): void {
    this.enabled = false
    logInfo('调试监控已禁用', 'DebugMonitor')
  }

  /**
   * 记录性能指标
   */
  recordMetric(name: string, duration: number, metadata?: Record<string, any>): void {
    if (!this.enabled) return

    const metric: PerformanceMetric = {
      name,
      duration,
      timestamp: Date.now(),
      metadata
    }

    this.metrics.push(metric)

    // 限制指标数量
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics)
    }

    // 如果是慢查询，额外记录
    if (duration > 1000) {
      logWarn(`慢查询检测: ${name}`, 'DebugMonitor', { duration, metadata })
    }

    logDebug('性能指标记录', 'DebugMonitor', { name, duration, metadata })
  }

  /**
   * 包装函数以测量性能
   */
  async measurePerformance<T>(
    name: string,
    fn: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<T> {
    const start = performance.now()
    try {
      const result = await fn()
      const duration = performance.now() - start
      this.recordMetric(name, duration, metadata)
      return result
    } catch (error) {
      const duration = performance.now() - start
      this.recordMetric(`${name}_error`, duration, metadata)
      throw error
    }
  }

  /**
   * 记录错误
   */
  recordError(error: Error, context?: string, module?: string): void {
    if (!this.enabled) return

    const errorInfo: ErrorInfo = {
      message: error.message,
      stack: error.stack,
      timestamp: Date.now(),
      context,
      module
    }

    this.errors.push(errorInfo)

    // 限制错误数量
    if (this.errors.length > this.maxErrors) {
      this.errors = this.errors.slice(-this.maxErrors)
    }

    logError(`错误记录: ${error.message}`, module || 'DebugMonitor', { context, stack: error.stack })
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(): {
    totalCalls: number
    avgDuration: number
    slowest?: PerformanceMetric
    byName: Record<string, { count: number; avg: number; max: number }>
  } {
    if (this.metrics.length === 0) {
      return { totalCalls: 0, avgDuration: 0, byName: {} }
    }

    const totalDuration = this.metrics.reduce((sum, m) => sum + m.duration, 0)
    const avgDuration = totalDuration / this.metrics.length

    // 按名称分组统计
    const byName: Record<string, { count: number; avg: number; max: number }> = {}
    this.metrics.forEach(m => {
      if (!byName[m.name]) {
        byName[m.name] = { count: 0, avg: 0, max: 0 }
      }
      const stats = byName[m.name]
      stats.count++
      stats.avg += m.duration
      if (m.duration > stats.max) {
        stats.max = m.duration
      }
    })

    // 计算平均值
    Object.keys(byName).forEach(name => {
      byName[name].avg = byName[name].avg / byName[name].count
    })

    // 找出最慢的调用
    const slowest = this.metrics.reduce((prev, current) => 
      prev.duration > current.duration ? prev : current
    )

    return {
      totalCalls: this.metrics.length,
      avgDuration,
      slowest,
      byName
    }
  }

  /**
   * 获取错误统计
   */
  getErrorStats(): {
    totalErrors: number
    byModule: Record<string, number>
    recentErrors: ErrorInfo[]
  } {
    const byModule: Record<string, number> = {}
    this.errors.forEach(e => {
      const module = e.module || 'unknown'
      byModule[module] = (byModule[module] || 0) + 1
    })

    return {
      totalErrors: this.errors.length,
      byModule,
      recentErrors: this.errors.slice(-10).reverse()
    }
  }

  /**
   * 生成调试报告
   */
  async generateReport(): Promise<DebugInfo> {
    const settings = getSettings()
    const memory = process.memoryUsage()
    
    // 获取RAG相关统计（异步）
    let ragStats: any = {}
    try {
      const { getDocCount } = await import('../rag/store/index')
      const { getQueryCacheStats } = await import('../rag/store/index')
      ragStats.docCount = await getDocCount()
      ragStats.cacheStats = getQueryCacheStats()
      ragStats.embeddingsReady = true // 简化检查
    } catch (e) {
      ragStats.error = '无法获取RAG统计'
    }

    return {
      timestamp: Date.now(),
      system: {
        platform: process.platform,
        arch: process.arch,
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        memory: {
          used: Math.round(memory.heapUsed / 1024 / 1024),
          total: Math.round(memory.heapTotal / 1024 / 1024),
          percentage: Math.round((memory.heapUsed / memory.heapTotal) * 100)
        }
      },
      app: {
        version: process.env.npm_package_version || 'unknown',
        settings,
        uptime: Math.floor((Date.now() - this.startTime) / 1000)
      },
      rag: ragStats,
      performance: this.metrics.slice(-20), // 最近20个指标
      errors: this.errors.slice(-10) // 最近10个错误
    }
  }

  /**
   * 清除历史数据
   */
  clear(): void {
    this.metrics = []
    this.errors = []
    this.startTime = Date.now()
    logInfo('调试数据已清除', 'DebugMonitor')
  }

  /**
   * 导出数据
   */
  exportData(): {
    metrics: PerformanceMetric[]
    errors: ErrorInfo[]
    summary: any
  } {
    const perfStats = this.getPerformanceStats()
    const errorStats = this.getErrorStats()

    return {
      metrics: this.metrics,
      errors: this.errors,
      summary: {
        performance: perfStats,
        errors: errorStats,
        timeRange: {
          start: this.startTime,
          end: Date.now(),
          duration: Date.now() - this.startTime
        }
      }
    }
  }

  /**
   * 检查系统健康状况
   */
  async checkHealth(): Promise<{
    status: 'healthy' | 'warning' | 'error'
    issues: string[]
    suggestions: string[]
  }> {
    const issues: string[] = []
    const suggestions: string[] = []

    // 检查内存使用
    const memory = process.memoryUsage()
    const memoryPercentage = (memory.heapUsed / memory.heapTotal) * 100
    if (memoryPercentage > 80) {
      issues.push(`内存使用率过高: ${memoryPercentage.toFixed(1)}%`)
      suggestions.push('考虑重启应用或清理缓存')
    }

    // 检查错误率
    const errorStats = this.getErrorStats()
    if (errorStats.totalErrors > 10) {
      issues.push(`近期错误较多: ${errorStats.totalErrors}个`)
      suggestions.push('查看错误日志，排查问题根源')
    }

    // 检查性能
    const perfStats = this.getPerformanceStats()
    if (perfStats.slowest && perfStats.slowest.duration > 5000) {
      issues.push(`存在极慢操作: ${perfStats.slowest.name} (${perfStats.slowest.duration.toFixed(0)}ms)`)
      suggestions.push('优化相关操作，考虑使用缓存或异步处理')
    }

    // 检查RAG状态
    try {
      const { getDocCount } = await import('../rag/store/index')
      const docCount = await getDocCount()
      if (docCount === 0) {
        issues.push('知识库为空')
        suggestions.push('请导入文档以构建知识库')
      }
    } catch (e) {
      issues.push('无法检查RAG状态')
    }

    const status = issues.length === 0 ? 'healthy' : issues.length < 3 ? 'warning' : 'error'

    return { status, issues, suggestions }
  }
}

/**
 * 便捷函数：测量性能
 */
export async function measurePerformance<T>(
  name: string,
  fn: () => Promise<T>,
  metadata?: Record<string, any>
): Promise<T> {
  return DebugMonitor.getInstance().measurePerformance(name, fn, metadata)
}

/**
 * 便捷函数：记录错误
 */
export function recordError(error: Error, context?: string, module?: string): void {
  DebugMonitor.getInstance().recordError(error, context, module)
}

/**
 * 便捷函数：获取调试报告
 */
export async function getDebugReport(): Promise<DebugInfo> {
  return DebugMonitor.getInstance().generateReport()
}

/**
 * 便捷函数：检查健康状况
 */
export async function checkHealth(): ReturnType<DebugMonitor['checkHealth']> {
  return DebugMonitor.getInstance().checkHealth()
}

/**
 * 性能分析器 - 用于分析特定操作的性能瓶颈
 */
export class PerformanceAnalyzer {
  private timings: Map<string, number[]> = new Map()
  private enabled: boolean = true

  /**
   * 记录时间点
   */
  recordTiming(name: string, duration: number): void {
    if (!this.enabled) return

    if (!this.timings.has(name)) {
      this.timings.set(name, [])
    }
    this.timings.get(name)!.push(duration)
  }

  /**
   * 获取分析结果
   */
  getAnalysis(): Record<string, { avg: number; min: number; max: number; count: number }> {
    const result: Record<string, any> = {}

    this.timings.forEach((durations, name) => {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length
      const min = Math.min(...durations)
      const max = Math.max(...durations)

      result[name] = {
        avg: Number(avg.toFixed(2)),
        min: Number(min.toFixed(2)),
        max: Number(max.toFixed(2)),
        count: durations.length
      }
    })

    return result
  }

  /**
   * 重置分析器
   */
  reset(): void {
    this.timings.clear()
  }

  /**
   * 导出为CSV
   */
  exportCSV(): string {
    const analysis = this.getAnalysis()
    let csv = 'Operation,Average,Min,Max,Count\n'
    
    Object.entries(analysis).forEach(([name, stats]) => {
      csv += `${name},${stats.avg},${stats.min},${stats.max},${stats.count}\n`
    })

    return csv
  }
}

/**
 * 事件性能监控器 - 监控特定事件的性能
 */
export class EventPerformanceMonitor {
  private eventTimings: Map<string, { start: number; end: number }[]> = new Map()
  private enabled: boolean = true

  /**
   * 开始记录事件
   */
  startEvent(eventName: string): string {
    const eventId = `${eventName}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    
    if (!this.eventTimings.has(eventName)) {
      this.eventTimings.set(eventName, [])
    }

    const timing = { start: performance.now(), end: 0 }
    // 使用临时存储，稍后更新
    ;(this.eventTimings.get(eventName) as any[]).push({ timing, eventId })

    return eventId
  }

  /**
   * 结束事件记录
   */
  endEvent(eventId: string): void {
    const end = performance.now()
    
    // 查找并更新对应的事件
    for (const [eventName, timings] of this.eventTimings.entries()) {
      const event = (timings as any[]).find((t: any) => t.eventId === eventId)
      if (event) {
        event.timing.end = end
        const duration = event.timing.end - event.timing.start
        
        // 记录到主监控器
        DebugMonitor.getInstance().recordMetric(eventName, duration)
        
        logDebug(`事件性能: ${eventName}`, 'EventMonitor', { duration })
        return
      }
    }
  }

  /**
   * 获取事件统计
   */
  getEventStats(): Record<string, { avgDuration: number; count: number }> {
    const result: Record<string, any> = {}

    for (const [eventName, timings] of this.eventTimings.entries()) {
      const completedTimings = (timings as any[]).filter((t: any) => t.timing.end > 0)
      if (completedTimings.length === 0) continue

      const durations = completedTimings.map((t: any) => t.timing.end - t.timing.start)
      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length

      result[eventName] = {
        avgDuration: Number(avgDuration.toFixed(2)),
        count: durations.length
      }
    }

    return result
  }

  /**
   * 重置
   */
  reset(): void {
    this.eventTimings.clear()
  }
}

/**
 * 系统资源监控器
 */
export class SystemResourceMonitor {
  private checkInterval: NodeJS.Timeout | null = null
  private thresholds = {
    memory: 80, // 80% 内存使用率
    cpu: 70,    // 70% CPU 使用率（需要额外实现）
    storage: 85  // 85% 存储使用率（需要额外实现）
  }

  /**
   * 开始监控
   */
  start(intervalMs: number = 30000): void {
    if (this.checkInterval) return

    logInfo('系统资源监控已启动', 'ResourceMonitor', { intervalMs })
    
    this.checkInterval = setInterval(() => {
      this.checkResources()
    }, intervalMs)
  }

  /**
   * 停止监控
   */
  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
      logInfo('系统资源监控已停止', 'ResourceMonitor')
    }
  }

  /**
   * 检查资源使用情况
   */
  private checkResources(): void {
    const memory = process.memoryUsage()
    const memoryPercent = (memory.heapUsed / memory.heapTotal) * 100

    if (memoryPercent > this.thresholds.memory) {
      logWarn(`内存使用率过高: ${memoryPercent.toFixed(1)}%`, 'ResourceMonitor', {
        used: Math.round(memory.heapUsed / 1024 / 1024) + 'MB',
        total: Math.round(memory.heapTotal / 1024 / 1024) + 'MB'
      })

      // 触发清理
      this.triggerCleanup()
    }

    // 检查缓存大小
    if (memory.heapUsed > 500 * 1024 * 1024) { // 500MB
      logInfo('内存占用超过500MB，建议清理缓存', 'ResourceMonitor')
    }
  }

  /**
   * 触发清理操作
   */
  private triggerCleanup(): void {
    // 清理全局缓存
    if (global.gc) {
      logInfo('执行垃圾回收', 'ResourceMonitor')
      global.gc()
    }

    // 清理查询缓存
    import('../rag/store/index').then(({ pruneExpiredCaches }) => {
      const result = pruneExpiredCaches()
      if (result.pruned > 0) {
        logInfo(`清理了 ${result.pruned} 个过期缓存`, 'ResourceMonitor')
      }
    }).catch(e => {
      logWarn('清理缓存失败', 'ResourceMonitor', undefined, e)
    })
  }

  /**
   * 获取资源状态
   */
  getResourceStatus(): {
    memory: {
      used: number
      total: number
      percentage: number
      status: 'normal' | 'warning' | 'critical'
    }
  } {
    const memory = process.memoryUsage()
    const percentage = (memory.heapUsed / memory.heapTotal) * 100

    let status: 'normal' | 'warning' | 'critical' = 'normal'
    if (percentage > this.thresholds.memory) status = 'critical'
    else if (percentage > this.thresholds.memory * 0.8) status = 'warning'

    return {
      memory: {
        used: Math.round(memory.heapUsed / 1024 / 1024),
        total: Math.round(memory.heapTotal / 1024 / 1024),
        percentage: Math.round(percentage),
        status
      }
    }
  }
}

// 全局调试监控实例
export const globalDebugMonitor = DebugMonitor.getInstance()
