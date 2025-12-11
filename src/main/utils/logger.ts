/**
 * 结构化日志系统
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3
}

interface LogEntry {
  level: LogLevel
  message: string
  timestamp: number
  context?: string
  metadata?: Record<string, unknown>
  error?: Error
}

class Logger {
  private level: LogLevel = LogLevel.INFO
  private entries: LogEntry[] = []
  private maxEntries = 1000 // 最多保留1000条日志

  constructor() {
    // 根据环境设置日志级别
    if (process.env.NODE_ENV === 'development') {
      this.level = LogLevel.DEBUG
    } else {
      this.level = LogLevel.INFO
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level >= this.level
  }

  private log(level: LogLevel, message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    if (!this.shouldLog(level)) return

    const entry: LogEntry = {
      level,
      message,
      timestamp: Date.now(),
      context,
      metadata,
      error
    }

    // 添加到内存缓冲区
    this.entries.push(entry)
    if (this.entries.length > this.maxEntries) {
      this.entries.shift() // 删除最旧的条目
    }

    // 输出到控制台
    const prefix = `[${LogLevel[level]}]${context ? ` [${context}]` : ''}`
    const timestamp = new Date(entry.timestamp).toISOString()
    
    switch (level) {
      case LogLevel.DEBUG:
        console.debug(`${timestamp} ${prefix}`, message, metadata || '')
        break
      case LogLevel.INFO:
        console.log(`${timestamp} ${prefix}`, message, metadata || '')
        break
      case LogLevel.WARN:
        console.warn(`${timestamp} ${prefix}`, message, metadata || '')
        if (error) console.warn(error)
        break
      case LogLevel.ERROR:
        console.error(`${timestamp} ${prefix}`, message, metadata || '')
        if (error) console.error(error)
        break
    }
  }

  debug(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.DEBUG, message, context, metadata)
  }

  info(message: string, context?: string, metadata?: Record<string, unknown>): void {
    this.log(LogLevel.INFO, message, context, metadata)
  }

  warn(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.WARN, message, context, metadata, error)
  }

  error(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
    this.log(LogLevel.ERROR, message, context, metadata, error)
  }

  /**
   * 获取最近的日志条目
   */
  getRecentEntries(count: number = 100, level?: LogLevel): LogEntry[] {
    let filtered = this.entries
    if (level !== undefined) {
      filtered = this.entries.filter(entry => entry.level >= level)
    }
    return filtered.slice(-count)
  }

  /**
   * 清除所有日志
   */
  clear(): void {
    this.entries = []
  }

  /**
   * 设置日志级别
   */
  setLevel(level: LogLevel): void {
    this.level = level
  }

  /**
   * 获取当前日志级别
   */
  getLevel(): LogLevel {
    return this.level
  }
}

// 导出单例实例
export const logger = new Logger()

// 导出便捷函数
export function logDebug(message: string, context?: string, metadata?: Record<string, unknown>): void {
  logger.debug(message, context, metadata)
}

export function logInfo(message: string, context?: string, metadata?: Record<string, unknown>): void {
  logger.info(message, context, metadata)
}

export function logWarn(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
  logger.warn(message, context, metadata, error)
}

export function logError(message: string, context?: string, metadata?: Record<string, unknown>, error?: Error): void {
  logger.error(message, context, metadata, error)
}

